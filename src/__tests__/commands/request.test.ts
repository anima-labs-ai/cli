/**
 * `am request` — provisioning requests from the agent's side.
 *
 * The behaviours worth pinning here are the ones that decide whether an agent
 * can act on the result correctly:
 *
 *   - `list` must render in the AGENT format. `output.info` is human-only, so a
 *     command that used it would print a heading and no rows to every non-TTY
 *     caller — the exact bug that made four vault commands report success they
 *     had not achieved.
 *   - `status` must exit non-zero on a terminal non-APPROVED outcome, or an
 *     agent gating on `am request status $ID && next` proceeds as though a
 *     decline were a grant.
 *   - `emailSent: false` must be reported, not swallowed. It does not mean the
 *     request failed, but the agent must not assume a human was told.
 *   - a 403 on approve must name the fix (master credential), because using an
 *     agent key there is the single most likely mistake.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { resetPathsCache, setPathsOverride } from "../../lib/config.js";

const testConfigDir = join(import.meta.dir, ".test-request-config");

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
	assert?: (ctx: { url: URL; body: unknown }) => void;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let program: Command;
const routes: Record<string, RouteResponse> = {};

function setRoute(method: string, path: string, route: RouteResponse): void {
	routes[`${method} ${path}`] = route;
}

class ExitError extends Error {
	constructor(public code?: number) {
		super(`process.exit(${code})`);
	}
}

async function runProgram(
	args: string[],
): Promise<{ code?: number; logs: string[] }> {
	const origExit = process.exit;
	const origLog = console.log;
	const origError = console.error;
	const logs: string[] = [];
	const capture = (...parts: unknown[]) => {
		logs.push(parts.map(String).join(" "));
	};
	let exitCode: number | undefined;
	process.exit = ((code?: number) => {
		exitCode = code;
		throw new ExitError(code);
	}) as typeof process.exit;
	console.log = capture;
	console.error = capture;
	try {
		await program.parseAsync(["node", "anima", ...args]);
	} catch (error) {
		if (!(error instanceof ExitError)) throw error;
	} finally {
		process.exit = origExit;
		console.log = origLog;
		console.error = origError;
	}
	return { code: exitCode, logs };
}

const PENDING = {
	requestId: "preq_1",
	agentId: "agent_1",
	agentName: "shopping-agent",
	resource: "VAULT",
	reason: "To store the Stripe key",
	status: "PENDING",
	options: null,
	expiresAt: "2026-08-11T00:00:00Z",
	decidedAt: null,
	decidedNote: null,
	provisionedId: null,
	createdAt: "2026-08-04T00:00:00Z",
};

describe("am request", () => {
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
		if (!existsSync(testConfigDir))
			mkdirSync(testConfigDir, { recursive: true });

		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				const route = routes[`${req.method} ${url.pathname}`];
				if (!route) {
					return new Response(
						JSON.stringify({
							error: { code: "NOT_FOUND", message: "Not Found" },
						}),
						{ status: 404, headers: { "Content-Type": "application/json" } },
					);
				}
				const text = await req.text();
				route.assert?.({ url, body: text ? JSON.parse(text) : undefined });
				return new Response(JSON.stringify(route.body), {
					status: route.status,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
		mockServer = server;
		writeFileSync(
			join(testConfigDir, "auth.json"),
			JSON.stringify({
				token: "test-token",
				apiUrl: `http://localhost:${server.port}`,
			}),
		);
	});

	afterEach(() => {
		mockServer?.stop();
		mockServer = null;
		for (const key of Object.keys(routes)) delete routes[key];
		if (existsSync(testConfigDir))
			rmSync(testConfigDir, { recursive: true, force: true });
	});

	test("request vault posts the ask with the reason", async () => {
		let seen: Record<string, unknown> | undefined;
		setRoute("POST", "/v1/provisioning-requests", {
			status: 200,
			body: { ...PENDING, emailSent: true },
			assert: ({ body }) => {
				seen = body as Record<string, unknown>;
			},
		});

		const { code } = await runProgram([
			"request",
			"vault",
			"--reason",
			"To store the Stripe key",
		]);
		expect(code).toBeUndefined();
		expect(seen?.resource).toBe("VAULT");
		expect(seen?.reason).toBe("To store the Stripe key");
	});

	test("request phone carries country and area code as options", async () => {
		let seen: Record<string, unknown> | undefined;
		setRoute("POST", "/v1/provisioning-requests", {
			status: 200,
			body: { ...PENDING, resource: "PHONE_NUMBER", emailSent: true },
			assert: ({ body }) => {
				seen = body as Record<string, unknown>;
			},
		});

		await runProgram([
			"request",
			"phone",
			"--reason",
			"delivery texts",
			"--country",
			"us",
			"--area-code",
			"415",
		]);
		expect(seen?.resource).toBe("PHONE_NUMBER");
		expect(seen?.options).toEqual({ countryCode: "US", areaCode: "415" });
	});

	test("a failed owner notification is reported in both formats, not swallowed", async () => {
		setRoute("POST", "/v1/provisioning-requests", {
			status: 200,
			body: { ...PENDING, emailSent: false },
		});

		// Agent format: the fact travels in the payload, which is the machine
		// contract — an agent reads `emailSent`, not prose.
		const machine = await runProgram([
			"--format",
			"agent",
			"request",
			"vault",
			"--reason",
			"x",
		]);
		expect(machine.logs.join("\n")).toContain('"emailSent":false');

		// Human format: spelled out, because a person will not be inspecting JSON
		// and must not conclude their owner was told when nothing was sent.
		const human = await runProgram([
			"--human",
			"request",
			"vault",
			"--reason",
			"x",
		]);
		expect(human.logs.join("\n")).toContain("No owner email went out");
	});

	test("list renders rows in the agent format, not just a heading", async () => {
		setRoute("GET", "/v1/provisioning-requests", {
			status: 200,
			body: {
				items: [PENDING],
				pagination: { nextCursor: null, hasMore: false },
			},
		});

		// `--format agent` is what every non-TTY caller resolves to. A command
		// built on output.info would print nothing here.
		const { logs } = await runProgram(["--format", "agent", "request", "list"]);
		const out = logs.join("\n");
		expect(out).toContain("preq_1");
		expect(out).toContain("shopping-agent");
	});

	test("status exits non-zero when the request was declined", async () => {
		setRoute("GET", "/v1/provisioning-requests/preq_1", {
			status: 200,
			body: {
				...PENDING,
				status: "DECLINED",
				decidedNote: "Tell me which API",
			},
		});

		// A zero exit here would let `am request status $ID && do-the-thing`
		// proceed on a refusal.
		const { code } = await runProgram(["request", "status", "preq_1"]);
		expect(code).toBe(1);
	});

	test("status exits zero while the ask is still live", async () => {
		setRoute("GET", "/v1/provisioning-requests/preq_1", {
			status: 200,
			body: PENDING,
		});
		const { code } = await runProgram(["request", "status", "preq_1"]);
		expect(code).toBeUndefined();
	});

	test("a 403 on approve names the missing master credential", async () => {
		setRoute("POST", "/v1/provisioning-requests/preq_1/approve", {
			status: 403,
			body: {
				error: {
					code: "FORBIDDEN",
					message: "Master key required for this operation.",
				},
			},
		});

		const { code, logs } = await runProgram(["request", "approve", "preq_1"]);
		expect(code).toBe(1);
		// Using an agent key here is the likeliest mistake, so the message has to
		// carry the remedy rather than only the refusal. The remedy is no longer a
		// command to run — elevation happens inside the failing command — so what
		// has to reach the user is where to run it from.
		expect(logs.join("\n")).toContain("interactive terminal");
		expect(logs.join("\n")).toContain("mk_");
	});

	test("empty request ids are rejected before any call is made", async () => {
		let reached = false;
		setRoute("POST", "/v1/provisioning-requests/preq_1/cancel", {
			status: 200,
			body: PENDING,
			assert: () => {
				reached = true;
			},
		});

		for (const args of [
			["request", "status", ""],
			["request", "cancel", ""],
			["request", "approve", ""],
			["request", "decline", ""],
		]) {
			let threw = false;
			try {
				await program.parseAsync(["node", "anima", ...args]);
			} catch (error) {
				threw = true;
				expect((error as { code?: string }).code).toBe(
					"commander.invalidArgument",
				);
			}
			expect(threw).toBe(true);
			program = createProgram();
		}
		expect(reached).toBe(false);
	});
});
