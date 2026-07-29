/**
 * Validate an advertised command string against the real commander tree.
 *
 * Shared by the `demo` and `onboard` guards. Both surfaces print commands for
 * a new user to run, and both have shipped fiction: demo once advertised
 * `email reply`, a `--text` flag and `anima x402 fetch`; onboard advertised
 * `anima demo --only-email` after demo lost its flags. One implementation, so
 * a fix to the checker covers every surface that advertises syntax.
 */
import type { Command } from "commander";

/** Tokenize a shell-ish command string, honoring single/double quotes. */
export function tokenize(command: string): string[] {
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
export function validateAdvertisedCommand(program: Command, commandStr: string): string[] {
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
