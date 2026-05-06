import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface StatusOptions {
  agent?: string;
}

export function statusCommand(): Command {
  return new Command('status')
    .description('Check vault status')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command) {
      const opts = this.opts<StatusOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.status({ agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Agent ID', opts.agent],
          ['Status', result.status],
          ['Server URL', result.serverUrl],
          ['Last Sync', result.lastSync ?? 'Never'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to fetch vault status: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to fetch vault status: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
