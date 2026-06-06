import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { resetPathsCache, setPathsOverride } from "../../lib/config.js";

const testConfigDir = join(import.meta.dir, ".test-onboard-config");

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

function writeAuthConfig(creds: Record<string, unknown>): void {
	writeFileSync(
		join(testConfigDir, "auth.json"),
		JSON.stringify({ ...creds, apiUrl: `http://localhost:${mockServer?.port}` }),
	);
}

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

function captureLogs(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const origLog = console.log;
	console.log = ((...a: unknown[]) => {
		logs.push(a.map(String).join(" "));
	}) as typeof console.log;
	return {
		logs,
		restore: () => {
			console.log = origLog;
		},
	};
}

describe("onboard command", () => {
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
					// Catch-all 404 mirroring the real API — this is what an
					// `org.me` route-skew looks like to the CLI.
					return new Response(
						JSON.stringify({ error: { code: "NOT_FOUND", message: "Route not found" } }),
						{ status: 404, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(route.status === 204 ? null : JSON.stringify(route.body), {
					status: route.status,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
		mockServer = server;
		writeAuthConfig({ apiKey: "ak_test_onboard_key" });
	});

	afterEach(() => {
		mockServer?.stop();
		mockServer = null;
		clearRoutes();
		if (existsSync(testConfigDir)) rmSync(testConfigDir, { recursive: true, force: true });
	});

	// Non-interactive (agent/pipe) with no credential: hand back a structured
	// next-step pointing at init. This also guards the dangerous direction —
	// if the gate regressed and launched the interactive wizard here, the real
	// clack.select would block on the test's stdin and hang this test.
	// (The interactive-human launch itself is exercised by a manual smoke test
	// at release time — same convention as init.test.ts, which doesn't drive
	// clack because module-mocking it leaks across test files.)
	test("emits needs_auth pointing at init in agent mode (no wizard)", async () => {
		writeFileSync(
			join(testConfigDir, "auth.json"),
			JSON.stringify({ apiUrl: `http://localhost:${mockServer?.port}` }),
		);

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "onboard"]);
		cap.restore();

		expect(code).toBe(1);
		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed).toMatchObject({
			status: "needs_auth",
			next_command: "anima init",
		});
	});

	// Issue 3: a 404 from org.me (stale-CLI route skew) must become an
	// actionable "your CLI is out of date" message — not opaque "Route not found".
	test("translates a 404 from org.me into cli_outdated guidance", async () => {
		// No /v1/orgs/me route registered → catch-all 404.
		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "onboard"]);
		cap.restore();

		expect(code).toBe(1);
		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed.status).toBe("cli_outdated");
		expect(printed.message).toContain("out of date");
		expect(printed.next_command).toContain("upgrade");
	});

	// Happy path: a working org.me + a verified agent yields the ready plan
	// with the verification status surfaced on `identity`.
	test("emits a ready plan and reports identity verified", async () => {
		setRoute("GET", "/v1/orgs/me", {
			status: 200,
			body: { id: "cm_org_1", name: "Test Org", slug: "test-org", tier: "FREE" },
		});
		setRoute("GET", "/v1/agent/status", {
			status: 200,
			body: { auth_type: "agent_verified" },
		});

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "onboard"]);
		cap.restore();

		expect(code).toBeUndefined(); // ready path returns, no exit
		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed.status).toBe("ready");
		expect(printed.identity).toMatchObject({
			org_id: "cm_org_1",
			tier: "FREE",
			verified: true,
			auth_type: "agent_verified",
		});
		// A verified agent should NOT be nudged to verify.
		expect(printed.next_steps.some((s: { command: string }) => s.command.startsWith("anima verify"))).toBe(
			false,
		);
	});

	// An unverified agent: identity.verified=false and the verify step leads
	// the next-steps so the agent is told exactly how to unlock sending.
	test("flags an unverified agent and leads with the verify step", async () => {
		setRoute("GET", "/v1/orgs/me", {
			status: 200,
			body: { id: "cm_org_1", name: "Test Org", slug: "test-org", tier: "FREE" },
		});
		setRoute("GET", "/v1/agent/status", {
			status: 200,
			body: { auth_type: "agent_unverified" },
		});

		const cap = captureLogs();
		await runProgram(["--format", "agent", "onboard"]);
		cap.restore();

		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed.identity).toMatchObject({ verified: false, auth_type: "agent_unverified" });
		expect(printed.next_steps[0].command).toContain("anima verify");
	});

	// Verification is best-effort: if /v1/agent/status is unavailable, the
	// ready plan still renders, just without the verification fields.
	test("still emits a ready plan when status is unavailable", async () => {
		setRoute("GET", "/v1/orgs/me", {
			status: 200,
			body: { id: "cm_org_1", name: "Test Org", slug: "test-org", tier: "FREE" },
		});
		// No /v1/agent/status route → 404 → non-fatal.

		const cap = captureLogs();
		const code = await runProgram(["--format", "agent", "onboard"]);
		cap.restore();

		expect(code).toBeUndefined();
		const printed = JSON.parse(cap.logs.at(-1) ?? "{}");
		expect(printed.status).toBe("ready");
		expect(printed.identity.verified).toBeUndefined();
		expect(printed.identity).toMatchObject({ org_id: "cm_org_1" });
	});
});
