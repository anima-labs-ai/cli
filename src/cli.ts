#!/usr/bin/env bun
import { Command } from 'commander';
import { authCommands } from './commands/auth/index.js';
import { identityCommands } from './commands/identity/index.js';
import { emailCommands } from './commands/email/index.js';
import { phoneCommands } from './commands/phone/index.js';
import { cardCommands } from './commands/card/index.js';
import { vaultCommands } from './commands/vault/index.js';
import { configCommands } from './commands/config/index.js';
import { setupMcpCommands } from './commands/setup-mcp/index.js';
import { extensionCommands } from './commands/extension/index.js';
import { adminCommands } from './commands/admin/index.js';
import { webhookCommands } from './commands/webhook/index.js';
import { securityCommands } from './commands/security/index.js';
import { initCommand } from './commands/init/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('am')
    .description('Anima CLI — Identity infrastructure for AI agents')
    .version('0.1.0')
    .option('--json', 'Output results as JSON', false)
    .option('--debug', 'Enable debug output', false)
    .option('--token <token>', 'API token (overrides stored auth)')
    .option('--api-url <url>', 'API base URL (overrides stored config)');

  program.addCommand(authCommands());
  program.addCommand(identityCommands());
  program.addCommand(emailCommands());
  program.addCommand(phoneCommands());
  program.addCommand(cardCommands());
  program.addCommand(vaultCommands());
  program.addCommand(configCommands());
  program.addCommand(setupMcpCommands());
  program.addCommand(extensionCommands());
  program.addCommand(adminCommands());
  program.addCommand(webhookCommands());
  program.addCommand(securityCommands());
  program.addCommand(initCommand());

  program.exitOverride();

  return program;
}

const isDirectExecution = process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js');

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
