import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface DeleteOptions {
  agent: string;
}

interface DeleteResponse {
  success: true;
}

export function deleteCommand(): Command {
  return new Command('delete')
    .description('Delete credential')
    .argument('<credentialId>', 'Credential ID')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<DeleteOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.delete<DeleteResponse>(
          `/vault/credentials/${credentialId}`,
          { agentId: opts.agent },
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Deleted credential ${credentialId}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to delete credential: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to delete credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
