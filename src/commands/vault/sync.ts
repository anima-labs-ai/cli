import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface SyncOptions {
  agent: string;
}

interface SyncResponse {
  success: true;
}

export function syncCommand(): Command {
  return new Command('sync')
    .description('Force vault sync')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<SyncOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<SyncResponse>('/vault/sync', {
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Vault synced for agent ${opts.agent}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to sync vault: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to sync vault: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
