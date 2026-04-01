import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface StatusOptions {
  agent: string;
}

interface VaultStatusResponse {
  serverUrl: string;
  lastSync: string | null;
  status: 'unlocked' | 'locked' | 'unauthenticated';
}

export function statusCommand(): Command {
  return new Command('status')
    .description('Check vault status')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<StatusOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<VaultStatusResponse>('/vault/status', {
          agentId: opts.agent,
        });

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
        if (error instanceof ApiError) {
          output.error(`Failed to fetch vault status: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to fetch vault status: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
