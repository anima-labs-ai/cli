#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "commander";
import pkg from "../package.json" with { type: "json" };
import { a2aCommands } from "./commands/a2a/index.js";
import { addressCommands } from "./commands/address/index.js";
import { adminCommands } from "./commands/admin/index.js";
import { authCommands } from "./commands/auth/index.js";
import { completionCommand } from "./commands/completion/index.js";
import { configCommands } from "./commands/config/index.js";
import { doctorCommand } from "./commands/doctor/index.js";
import { emailCommands } from "./commands/email/index.js";
import { extensionCommands } from "./commands/extension/index.js";
import { generateCommand } from "./commands/generate/index.js";
import { identityCommands } from "./commands/identity/index.js";
import { inboxCommands } from "./commands/inbox/index.js";
import { initCommand } from "./commands/init/index.js";
import { messageCommand } from "./commands/message/index.js";
import { onboardCommand } from "./commands/onboard/index.js";
import { orgCommands } from "./commands/org/index.js";
import { demoCommand } from "./commands/demo/index.js";
import { phoneCommands } from "./commands/phone/index.js";
import { registryCommands } from "./commands/registry/index.js";
import { securityCommands } from "./commands/security/index.js";
import { setupMcpCommands } from "./commands/setup-mcp/index.js";
import { tailCommand } from "./commands/tail/index.js";
import { vaultCommands } from "./commands/vault/index.js";
import { verifyCommand } from "./commands/verify/index.js";
import { voiceCommands } from "./commands/voice/index.js";
import { webhookCommands } from "./commands/webhook/index.js";

export function createProgram(): Command {
	const program = new Command();

	program
		.name("anima")
		.description("Anima CLI — Identity infrastructure for AI agents")
		.version(pkg.version)
		// Required so `am vault exec -- <cmd>` passes child-command flags through
		// to spawn() instead of being interpreted by us. Cascades to all subcommands.
		.enablePositionalOptions()
		.option(
			"--human",
			"Pretty-print for humans (tables, colors). Default output is agent format (compact JSON).",
			false,
		)
		.option(
			"--json",
			"Pretty-printed JSON output (for debugging). Agent default is more compact.",
			false,
		)
		.option(
			"--format <fmt>",
			"Output format: agent (default), human, json, yaml, jsonl, md",
			(value) => {
				const allowed = ["agent", "human", "json", "yaml", "jsonl", "md"];
				if (!allowed.includes(value)) {
					throw new InvalidArgumentError(
						`format must be one of ${allowed.join(", ")}`,
					);
				}
				return value;
			},
		)
		.option("--debug", "Enable debug output", false)
		.option(
			"--test",
			"Test mode — server uses test fixtures (no real outbound email/SMS, x402 sandbox settlement). Sent as X-Anima-Test-Mode: 1.",
			false,
		)
		.option("--token <token>", "API token (overrides stored auth)")
		.option("--api-url <url>", "API base URL (overrides stored config)");

	program.addCommand(addressCommands());
	program.addCommand(authCommands());
	program.addCommand(identityCommands());
	program.addCommand(emailCommands());
	program.addCommand(inboxCommands());
	program.addCommand(phoneCommands());
	program.addCommand(registryCommands());
	program.addCommand(vaultCommands());
	program.addCommand(configCommands());
	program.addCommand(setupMcpCommands());
	program.addCommand(extensionCommands());
	program.addCommand(adminCommands());
	program.addCommand(webhookCommands());
	program.addCommand(securityCommands());
	program.addCommand(initCommand());
	program.addCommand(onboardCommand());
	program.addCommand(verifyCommand());
	program.addCommand(orgCommands());
	program.addCommand(demoCommand());
	program.addCommand(a2aCommands());
	program.addCommand(messageCommand());
	program.addCommand(voiceCommands());
	program.addCommand(doctorCommand());
	program.addCommand(tailCommand());
	program.addCommand(completionCommand());
	program.addCommand(generateCommand());

	// `exitOverride()` only takes effect on the command it's called on —
	// it does NOT cascade to subcommands. Without applying it recursively,
	// errors from `am address create ...` (a subcommand) would bypass the
	// top-level catch block, so customizations like the
	// "commander.excessArguments" hint below would never fire.
	applyExitOverrideRecursive(program);

	return program;
}

function applyExitOverrideRecursive(cmd: Command): void {
	cmd.exitOverride();
	for (const sub of cmd.commands) {
		applyExitOverrideRecursive(sub);
	}
}

const arg1 = process.argv[1] ?? "";
// `import.meta.main` is Bun-specific: true only when THIS file is the entry
// point. We gate the Bun branch on it so `bun test` (which imports cli.ts
// for snapshot harnesses) does NOT auto-run the CLI and spam stderr with
// Commander help output. `tsconfig` has `types: ["node"]` so we need a type
// cast — the property is guarded-present at runtime under Bun.
const isBunDirectRun =
	"Bun" in globalThis &&
	(import.meta as unknown as { main?: boolean }).main === true;
const isDirectExecution =
	arg1.endsWith("cli.ts") ||
	arg1.endsWith("cli.js") ||
	arg1.endsWith("/anima") ||
	// `am` is the short alias bin published in package.json — both bin
	// entries (anima + am) point at dist/cli.js. Without this branch,
	// running `am` produced ZERO output (silent exit 0) because the
	// gate evaluated false and the parseAsync block was skipped.
	arg1.endsWith("/am") ||
	// Bun-compiled platform binaries: `anima-linux-x64`, `anima-linux-arm64`.
	// Match as a path-suffix so unrelated paths like `/home/anima-dev/...` don't trigger.
	// (We keep the broad regex so `bun build src/cli.ts` with any future target name still works.)
	/anima-[^/]+$/.test(arg1) ||
	isBunDirectRun;

if (isDirectExecution) {
	const program = createProgram();

	(async () => {
		try {
			await program.parseAsync(process.argv);
		} catch (error: unknown) {
			if (error instanceof Error && "code" in error) {
				const commanderError = error as Error & { code: string };
				if (
					commanderError.code === "commander.helpDisplayed" ||
					commanderError.code === "commander.version"
				) {
					return;
				}
				// `excessArguments` fires when an option value contains spaces
				// and the user didn't quote it: `--street1 my street` parses
				// as `--street1=my` + an unexpected positional `street`. The
				// raw message ("too many arguments... got 1") doesn't tell
				// the user what actually went wrong — append a concrete hint.
				if (commanderError.code === "commander.excessArguments") {
					console.error(
						'Hint: option values with spaces must be quoted. ' +
							'Example: --street1 "123 Main St" (not --street1 123 Main St).',
					);
					process.exit(1);
				}
				// Any other `commander.*` error (missing required option,
				// invalid argument, unknown option, etc.) — commander has
				// already printed its own `error: ...` line via writeErr.
				// Re-printing as `Error: error: ...` produced an ugly
				// double-stamp. Just exit.
				if (commanderError.code.startsWith("commander.")) {
					process.exit(1);
				}
			}
			if (error instanceof Error) {
				console.error(`Error: ${error.message}`);
			}
			process.exit(1);
		}
	})();
}
