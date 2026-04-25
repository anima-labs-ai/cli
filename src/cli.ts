#!/usr/bin/env bun
import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { addressCommands } from './commands/address/index.js';
import { authCommands } from './commands/auth/index.js';
import { identityCommands } from './commands/identity/index.js';
import { emailCommands } from './commands/email/index.js';
import { phoneCommands } from './commands/phone/index.js';
import { cardCommands } from './commands/card/index.js';
import { podCommands } from './commands/pod/index.js';
import { registryCommands } from './commands/registry/index.js';
import { vaultCommands } from './commands/vault/index.js';
import { walletCommands } from './commands/wallet/index.js';
import { configCommands } from './commands/config/index.js';
import { setupMcpCommands } from './commands/setup-mcp/index.js';
import { extensionCommands } from './commands/extension/index.js';
import { adminCommands } from './commands/admin/index.js';
import { webhookCommands } from './commands/webhook/index.js';
import { securityCommands } from './commands/security/index.js';
import { initCommand } from './commands/init/index.js';
import { a2aCommands } from './commands/a2a/index.js';
import { messageCommand } from './commands/message/index.js';
import { voiceCommands } from './commands/voice/index.js';
import { doctorCommand } from './commands/doctor/index.js';
import { tailCommand } from './commands/tail/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('anima')
    .description('Anima CLI — Identity infrastructure for AI agents')
    .version(pkg.version)
    // Required so `am vault exec -- <cmd>` passes child-command flags through
    // to spawn() instead of being interpreted by us. Cascades to all subcommands.
    .enablePositionalOptions()
    .option('--json', 'Output results as JSON', false)
    .option('--debug', 'Enable debug output', false)
    .option('--token <token>', 'API token (overrides stored auth)')
    .option('--api-url <url>', 'API base URL (overrides stored config)');

  program.addCommand(addressCommands());
  program.addCommand(authCommands());
  program.addCommand(identityCommands());
  program.addCommand(emailCommands());
  program.addCommand(phoneCommands());
  program.addCommand(cardCommands());
  program.addCommand(podCommands());
  program.addCommand(registryCommands());
  program.addCommand(vaultCommands());
  program.addCommand(walletCommands());
  program.addCommand(configCommands());
  program.addCommand(setupMcpCommands());
  program.addCommand(extensionCommands());
  program.addCommand(adminCommands());
  program.addCommand(webhookCommands());
  program.addCommand(securityCommands());
  program.addCommand(initCommand());
  program.addCommand(a2aCommands());
  program.addCommand(messageCommand());
  program.addCommand(voiceCommands());
  program.addCommand(doctorCommand());
  program.addCommand(tailCommand());

  program.exitOverride();

  return program;
}

const arg1 = process.argv[1] ?? '';
// `import.meta.main` is Bun-specific: true only when THIS file is the entry
// point. We gate the Bun branch on it so `bun test` (which imports cli.ts
// for snapshot harnesses) does NOT auto-run the CLI and spam stderr with
// Commander help output. `tsconfig` has `types: ["node"]` so we need a type
// cast — the property is guarded-present at runtime under Bun.
const isBunDirectRun =
  'Bun' in globalThis && (import.meta as unknown as { main?: boolean }).main === true;
const isDirectExecution =
  arg1.endsWith('cli.ts') ||
  arg1.endsWith('cli.js') ||
  arg1.endsWith('/anima') ||
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
      if (error instanceof Error && 'code' in error) {
        const commanderError = error as Error & { code: string };
        if (commanderError.code === 'commander.helpDisplayed' || commanderError.code === 'commander.version') {
          return;
        }
      }
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      }
      process.exit(1);
    }
  })();
}
