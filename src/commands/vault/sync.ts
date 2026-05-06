import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface SyncOptions {
  agent?: string;
}

export function syncCommand(): Command {
  return new Command('sync')
    .description('Force vault sync')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command) {
      const opts = this.opts<SyncOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.sync({ agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Vault synced for agent ${opts.agent ?? 'current'}`);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to sync vault: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to sync vault: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
