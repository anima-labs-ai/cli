import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface DeprovisionOptions {
  agent: string;
}

interface DeprovisionResponse {
  success: true;
}

export function deprovisionCommand(): Command {
  return new Command('deprovision')
    .description('Deprovision vault for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<DeprovisionOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<DeprovisionResponse>('/vault/deprovision', {
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Vault deprovisioned for agent ${opts.agent}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to deprovision vault: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to deprovision vault: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
