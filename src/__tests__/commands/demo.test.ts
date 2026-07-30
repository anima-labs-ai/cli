/**
 * Intent tests for `anima demo` (competitive-parity item C11).
 *
 * The first-run demo is marketing surface: everything it advertises must be
 * real, currently-shipping CLI syntax. The 2026-07-16 audit found it
 * advertising `email search`, `email reply`, a `--text` flag, and an
 * `anima x402 fetch` command — none of which exist (x402 is permanently out
 * of scope). These tests walk every advertised command against the ACTUAL
 * commander tree, so re-adding a fictional command or flag to the demo
 * fails the build instead of shipping.
 */
import { describe, test, expect, mock } from "bun:test";
import type { Command } from "commander";
import { createProgram } from "../../cli.js";
import { ADVERTISED_COMMANDS } from "../../commands/demo/index.js";
import { validateAdvertisedCommand } from "../helpers/advertised-commands.js";

describe("demo command", () => {
	test("every advertised command is real CLI syntax", () => {
		const program = createProgram();
		expect(ADVERTISED_COMMANDS.length).toBeGreaterThan(0);
		for (const entry of ADVERTISED_COMMANDS) {
			const problems = validateAdvertisedCommand(program, entry.command);
			// Include the command in the assertion so a failure names the culprit.
			expect({ command: entry.command, problems }).toEqual({
				command: entry.command,
				problems: [],
			});
		}
	});

	test("the validator itself rejects the fictional commands the demo used to advertise", () => {
		const program = createProgram();
		// Guard against the guard: if the walker ever goes soft, these
		// previously-advertised fictions must still be caught.
		const fictional = [
			"anima email search --query 'Hello'",
			"anima email reply msg_123 --text 'Reply text'",
			"anima email send --agent a --to b@c.d --subject s --text 'wrong flag'",
			"anima x402 fetch https://example.com --sandbox",
		];
		for (const command of fictional) {
			expect(validateAdvertisedCommand(program, command).length).toBeGreaterThan(0);
		}
	});

	test("agent-format demo payload advertises only the shared command list and no x402", async () => {
		const program = createProgram();

		const logSpy = mock((...args: unknown[]) => {});
		const originalLog = console.log;
		console.log = logSpy;

		try {
			await program.parseAsync(["node", "anima", "--json", "demo"]);
		} finally {
			console.log = originalLog;
		}

		const calls = logSpy.mock.calls;
		const lastArg = calls[calls.length - 1]?.[0];
		expect(typeof lastArg).toBe("string");
		const payload = JSON.parse(lastArg as string) as {
			demo: string;
			simulated: boolean;
			steps: Array<{ step: number; name: string; command: string }>;
		};

		expect(payload.demo).toBe("email");
		expect(payload.simulated).toBe(true);
		expect(payload.steps.map((step) => step.command)).toEqual(
			ADVERTISED_COMMANDS.map((entry) => entry.command),
		);

		const raw = JSON.stringify(payload);
		expect(raw).not.toContain("x402");
		expect(raw).not.toContain("--test");
		expect(raw).not.toContain("--text");
	});
});
