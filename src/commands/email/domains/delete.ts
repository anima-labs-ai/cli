import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

export function deleteDomainCommand(): Command {
  return new Command('delete')
    .description('Delete a sending domain')
    .argument('<id>', 'Domain ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.delete<Record<string, unknown>>(`/api/v1/domains/${id}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Deleted domain ${id}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to delete domain: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to delete domain: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
