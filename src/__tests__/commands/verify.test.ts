import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { resetPathsCache, setPathsOverride } from "../../lib/config.js";

const testConfigDir = join(import.meta.dir, ".test-verify-config");

mock.module("env-paths", () => ({
	default: () => ({
		config: testConfigDir,
		data: testConfigDir,
		cache: testConfigDir,
		log: testConfigDir,
		temp: testConfigDir,
	}),
}));

const { createProgram } = await import("../../cli.js");

interface RouteResponse {
	status: number;
	body: unknown;
	assert?: (ctx: { body: unknown }) => void;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;
const routes: Record<string, RouteResponse> = {};

function setRoute(method: string, path: string, route: RouteResponse): void {
	routes[`${method} ${path}`] = route;
}

function clearRoutes(): void {
	for (const key of Object.keys(routes)) delete routes[key];
}

function writeAuthConfig(port: number, creds: Record<string, unknown>): void {
	writeFileSync(
		join(testConfigDir, "auth.json"),
		JSON.stringify({ ...creds, apiUrl: `http://localhost:${port}` }),
	);
}

// process.exit throws so a command's exit aborts the action (instead of
// killing the test runner) and we can assert on the code.
class ExitError extends Error {
	constructor(public code?: number) {
		super(`process.exit(${code})`);
	}
}

async function runProgram(args: string[]): Promise<number | undefined> {
	const origExit = process.exit;
	let exitCode: number | undefined;
	process.exit = ((code?: number) => {
		exitCode = code;
		throw new ExitError(code);
	}) as typeof process.exit;
	try {
		await program.parseAsync(["node", "anima", ...args]);
	} catch (error) {
		if (!(error instanceof ExitError)) throw error;
	} finally {
		process.exit = origExit;
	}
	return exitCode;
}

function captureLogs(): { logs: string[]; errs: string[]; restore: () => void } {
	const logs: string[] = [];
	const errs: string[] = [];
	const origLog = console.log;
	const origErr = console.error;
	console.log = ((...a: unknown[]) => {
		logs.push(a.map(String).join(" "));
	}) as typeof console.log;
	console.error = ((...a: unknown[]) => {
		errs.push(a.map(String).join(" "));
	}) as typeof console.error;
	return {
		logs,
		errs,
		restore: () => {
			console.log = origLog;
			console.error = origErr;
		},
	};
}

describe("verify command", () => {
	beforeEach(() => {
		resetPathsCache();
		setPathsOverride({
			config: testConfigDir,
			data: testConfigDir,
			cache: testConfigDir,
			log: testConfigDir,
			temp: testConfigDir,
		});
		program = createProgram();
		if (!existsSync(testConfigDir)) mkdirSync(testConfigDir, { recursive: true });

		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				const route = routes[`${req.method} ${url.pathname}`];
				if (!route) {
					// Mirror the real API's catch-all 404 shape so the oRPC
					// client decodes it into an ORPCError(status:404).
					return new Response(
						JSON.stringify({ error: { code: "NOT_FOUND", message: "Route not found" } }),
						{ status: 404, headers: { "Content-Type": "application/json" } },
					);
				}
				let body: unknown;
				if (req.method !== "GET") {
					const text = await req.text();
					if (text) body = JSON.parse(text);
				}
				route.assert?.({ body });
				return new Response(route.status === 204 ? null : JSON.stringify(route.body), {
					status: route.status,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
		mockServer = server;
		writeAuthConfig(server.port ?? 0, { apiKey: "ak_test_verify_key" });
	});

	afterEach(() => {
		mockServer?.stop();
		mockServer = null;
		clearRoutes();
		if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
	});

	// Core handshake: the OTP is POSTed as { otp_code } and a verified
	// response unlocks the agent. This is the step the CLI never exposed.
	test("submits the OTP and reports the agent verified", async () => {
		let sentBody: unknown;
		setRoute("POST", "/v1/agent/verify", {
			status: 200,
			body: { verified: true, auth_type: "agent_verified" },
			assert: ({ body }) => {
				sentBody = body;
			},
		});

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "verify", "123456"]);
		cap.restore();

		expect(sentBody).toEqual({ otp_code: "123456" });
		expect(code).toBeUndefined(); // success path returns, no exit
		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed).toMatchObject({
			status: "verified",
			verified: true,
			auth_type: "agent_verified",
		});
	});

	// A wrong/expired code comes back 200 { verified:false } (not an error);
	// the command must surface that and exit non-zero so scripts can detect it.
	test("reports unverified on a wrong/expired code and exits non-zero", async () => {
		setRoute("POST", "/v1/agent/verify", {
			status: 200,
			body: { verified: false, auth_type: "agent_unverified" },
		});

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "verify", "000000"]);
		cap.restore();

		expect(code).toBe(1);
		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed).toMatchObject({ status: "unverified", verified: false });
	});

	// Format is validated locally — a malformed code must never reach the API.
	test("rejects a non-6-digit code before any network call", async () => {
		let hit = false;
		setRoute("POST", "/v1/agent/verify", {
			status: 200,
			body: { verified: true, auth_type: "agent_verified" },
			assert: () => {
				hit = true;
			},
		});

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "verify", "12ab"]);
		cap.restore();

		expect(hit).toBe(false);
		expect(code).toBe(1);
		expect(JSON.parse(cap.errs.at(-1) ?? "{}").message).toContain("6 digits");
	});

	// Verification needs the agent credential from init/login.
	test("errors clearly when not authenticated", async () => {
		writeFileSync(
			join(testConfigDir, "auth.json"),
			JSON.stringify({ apiUrl: `http://localhost:${mockServer?.port}` }),
		);

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "verify", "123456"]);
		cap.restore();

		expect(code).toBe(1);
		expect(JSON.parse(cap.errs.at(-1) ?? "{}").message).toContain("Not authenticated");
	});

	// Issue-3 hardening: a 404 from route skew becomes actionable guidance,
	// not the opaque "Route not found".
	test("translates a 404 into an out-of-date message", async () => {
		// No route registered → mock server returns the catch-all 404.
		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "verify", "123456"]);
		cap.restore();

		expect(code).toBe(1);
		expect(JSON.parse(cap.errs.at(-1) ?? "{}").message).toContain("out of date");
	});

	test("uses ANIMA_API_KEY when no credential is stored", async () => {
		writeAuthConfig(mockServer?.port ?? 0, {});
		process.env.ANIMA_API_KEY = "ak_env_verify_key";
		try {
			let sentBody: unknown;
			setRoute("POST", "/v1/agent/verify", {
				status: 200,
				body: { verified: true, auth_type: "agent_verified" },
				assert: ({ body }) => {
					sentBody = body;
				},
			});

			const cap = captureLogs();
			const code = await runProgram(["--format", "agent", "verify", "654321"]);
			cap.restore();

			expect(sentBody).toEqual({ otp_code: "654321" });
			expect(code).toBeUndefined();
			expect(JSON.parse(cap.logs.at(-1) ?? "{}")).toMatchObject({
				status: "verified",
				auth_type: "agent_verified",
			});
		} finally {
			delete process.env.ANIMA_API_KEY;
		}
	});
});
