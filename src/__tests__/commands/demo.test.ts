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

/** Tokenize a shell-ish command string, honoring single/double quotes. */
function tokenize(command: string): string[] {
	const tokens: string[] = [];
	const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(command)) !== null) {
		tokens.push(match[1] ?? match[2] ?? match[3]);
	}
	return tokens;
}

/**
 * Validate one advertised command string against the real commander tree.
 * Returns a list of problems (empty = the command is real syntax).
 */
function validateAdvertisedCommand(program: Command, commandStr: string): string[] {
	const problems: string[] = [];
	const tokens = tokenize(commandStr);
	let i = 0;

	if (tokens[i] !== "anima" && tokens[i] !== "am") {
		problems.push(`advertised command must start with "anima" or "am", got "${tokens[i]}"`);
		return problems;
	}
	i++;

	// Descend through subcommands until we hit a flag or a positional.
	let cmd: Command = program;
	while (i < tokens.length && !tokens[i].startsWith("-")) {
		const token = tokens[i];
		const sub = cmd.commands.find(
			(candidate) => candidate.name() === token || candidate.aliases().includes(token),
		);
		if (sub) {
			cmd = sub;
			i++;
			continue;
		}
		// Not a subcommand — only acceptable as a positional of a command
		// that actually declares positionals (e.g. `email get <id>`).
		if (cmd.registeredArguments.length === 0) {
			problems.push(`"${token}" is neither a subcommand nor an expected positional of "${cmd.name()}"`);
		}
		i++;
	}

	if (cmd === program) {
		problems.push(`"${commandStr}" resolves to no subcommand`);
		return problems;
	}

	// Every --flag must exist on the resolved command or as a global option.
	for (; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token.startsWith("--")) {
			continue; // option value or positional placeholder
		}
		const known =
			cmd.options.some((option) => option.long === token) ||
			program.options.some((option) => option.long === token);
		if (!known) {
			problems.push(`flag "${token}" does not exist on "${cmd.name()}"`);
		}
	}

	return problems;
}

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

		const logSpy = mock(() => {});
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
