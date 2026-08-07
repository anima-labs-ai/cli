/**
 * `am permissions` — the owner's standing decisions, from the CLI.
 *
 * What is worth pinning here, and why:
 *
 *   - the state ALIASES must translate. A human types `always`; the API stores
 *     `ALWAYS_ALLOW` and 422s on anything else. Sending the word through raw
 *     is the one mistake this command can make that still looks like it worked
 *     from the code, so the assertion is on what reaches the WIRE.
 *   - `bypass` must send `bypassReads` and NO procedurePath. The endpoint
 *     refuses a request carrying both, so a stray field turns the command into
 *     a permanent 422.
 *   - `list` must render in the machine format. `output.info` is human-only, so
 *     a command built on it prints a heading and no rows to every non-TTY
 *     caller — the bug that made four vault commands report success they had
 *     not achieved.
 *   - `list` must not hide rows from a machine caller. Trimming ~100 procedures
 *     down to the decided ones is a terminal-legibility choice, and silently
 *     applying it to `--format json` would shrink a scripted read.
 *   - a 403 must name the fix. An agent key can never reach this surface, so
 *     "not authenticated" would be actively wrong — the caller IS
 *     authenticated, as the wrong kind of principal.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { resetPathsCache, setPathsOverride } from "../../lib/config.js";

const testConfigDir = join(import.meta.dir, ".test-permissions-config");

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
		// Commander throws its own error for a rejected argument before any
		// action runs, which is exactly the path the validation test exercises.
		if (error instanceof Error && error.name === "CommanderError") {
			exitCode = 1;
		} else if (!(error instanceof ExitError)) {
			throw error;
		}
	} finally {
		process.exit = origExit;
		console.log = origLog;
		console.error = origError;
	}
	return { code: exitCode, logs };
}

const PATH = "/v1/agents/agent_1/permissions";

const LIST = {
	agentId: "agent_1",
	items: [
		{
			procedurePath: "agent.delete",
			group: "destructive",
			state: "NEVER",
			grantedBy: "user_owner",
			updatedAt: "2026-08-06T00:00:00Z",
		},
		{
			procedurePath: "apiKeys.list",
			group: "read",
			state: "ASK",
			grantedBy: null,
			updatedAt: null,
		},
		{
			procedurePath: "agent.updatePolicy",
			group: "write",
			state: "ALWAYS_ALLOW",
			grantedBy: "user_owner",
			updatedAt: "2026-08-06T00:00:00Z",
		},
	],
	bypassReads: false,
};

describe("am permissions", () => {
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

	test("set translates the typed word into the stored state", async () => {
		// The assertion that matters. `always` is what a human types and
		// ALWAYS_ALLOW is what the column holds; sending the former is a 422 the
		// code cannot distinguish from a typo'd procedure path.
		let seen: Record<string, unknown> | undefined;
		setRoute("POST", PATH, {
			status: 200,
			body: {
				agentId: "agent_1",
				procedurePath: "agent.delete",
				state: "ALWAYS_ALLOW",
				bypassReads: false,
			},
			assert: ({ body }) => {
				seen = body as Record<string, unknown>;
			},
		});

		const { code } = await runProgram([
			"permissions",
			"set",
			"agent_1",
			"agent.delete",
			"always",
		]);
		expect(code).toBeUndefined();
		expect(seen?.state).toBe("ALWAYS_ALLOW");
		expect(seen?.procedurePath).toBe("agent.delete");
		expect(seen?.bypassReads).toBeUndefined();
	});

	test("never and ask translate too, case-insensitively", async () => {
		const states: Array<[string, string]> = [
			["never", "NEVER"],
			["ASK", "ASK"],
		];
		for (const [typed, stored] of states) {
			let seen: Record<string, unknown> | undefined;
			setRoute("POST", PATH, {
				status: 200,
				body: { agentId: "agent_1", state: stored, bypassReads: false },
				assert: ({ body }) => {
					seen = body as Record<string, unknown>;
				},
			});
			program = createProgram();
			await runProgram([
				"permissions",
				"set",
				"agent_1",
				"agent.delete",
				typed,
			]);
			expect(seen?.state).toBe(stored);
		}
	});

	test("an unknown state is refused before anything reaches the wire", async () => {
		let called = false;
		setRoute("POST", PATH, {
			status: 200,
			body: {},
			assert: () => {
				called = true;
			},
		});

		const { code } = await runProgram([
			"permissions",
			"set",
			"agent_1",
			"agent.delete",
			"maybe",
		]);
		expect(code).not.toBe(0);
		// A request would have written a row for a state the server had to guess.
		expect(called).toBe(false);
	});

	test("bypass sends bypassReads and no procedure path", async () => {
		// The endpoint refuses a body carrying both, so a stray procedurePath
		// here would make the command permanently 422.
		let seen: Record<string, unknown> | undefined;
		setRoute("POST", PATH, {
			status: 200,
			body: {
				agentId: "agent_1",
				procedurePath: null,
				state: null,
				bypassReads: true,
			},
			assert: ({ body }) => {
				seen = body as Record<string, unknown>;
			},
		});

		const { code } = await runProgram([
			"permissions",
			"bypass",
			"agent_1",
			"on",
		]);
		expect(code).toBeUndefined();
		expect(seen?.bypassReads).toBe(true);
		expect(seen?.procedurePath).toBeUndefined();
		expect(seen?.state).toBeUndefined();
	});

	test("list renders rows in the machine format, not a bare heading", async () => {
		setRoute("GET", PATH, { status: 200, body: LIST });

		// Globals are declared on the program, so they precede the subcommand.
		const { code, logs } = await runProgram([
			"--format",
			"json",
			"permissions",
			"list",
			"agent_1",
		]);
		expect(code).toBeUndefined();
		const parsed = JSON.parse(logs.join("\n")) as typeof LIST;
		// Every row, including the undecided one — a machine caller reading this
		// to reconcile state must not receive a view trimmed for a terminal.
		expect(parsed.items).toHaveLength(3);
		expect(parsed.bypassReads).toBe(false);
	});

	test("the human list shows decided rows and says how many it hid", async () => {
		setRoute("GET", PATH, { status: 200, body: LIST });

		// `--human` because the CLI defaults to the AGENT format; a bare
		// `am permissions list` is machine output, not a table.
		const { code, logs } = await runProgram([
			"--human",
			"permissions",
			"list",
			"agent_1",
		]);
		expect(code).toBeUndefined();
		const out = logs.join("\n");
		expect(out).toContain("agent.delete");
		expect(out).toContain("agent.updatePolicy");
		// The one still on ASK is hidden, but its absence is stated rather than
		// silent — otherwise the list reads as the complete set of options.
		expect(out).not.toContain("apiKeys.list");
		expect(out).toContain("1 more");
	});

	test("--all includes the procedures nobody has decided", async () => {
		setRoute("GET", PATH, { status: 200, body: LIST });

		const { logs } = await runProgram([
			"--human",
			"permissions",
			"list",
			"agent_1",
			"--all",
		]);
		expect(logs.join("\n")).toContain("apiKeys.list");
	});

	test("a 403 names the master credential rather than blaming auth", async () => {
		setRoute("GET", PATH, {
			status: 403,
			body: {
				code: "MASTER_KEY_REQUIRED",
				message: "Reading an agent's permissions requires master authority.",
			},
		});

		const { code, logs } = await runProgram([
			"--human",
			"permissions",
			"list",
			"agent_1",
		]);
		expect(code).toBe(1);
		const out = logs.join("\n");
		expect(out).toContain("master");
		// "Not authenticated" would send the caller to `am auth login`, which
		// changes nothing — an agent key cannot reach this surface at all.
		expect(out).not.toContain("Not authenticated");
	});
});
