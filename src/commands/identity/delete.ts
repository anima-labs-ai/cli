import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface DeleteIdentityOptions {
  id: string;
}

export function deleteIdentityCommand(): Command {
  return new Command('delete')
    .description('Delete an identity')
    .requiredOption('--id <id>', 'Identity ID')
    .action(async function (this: Command) {
      const opts = this.opts<DeleteIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.delete<Record<string, unknown>>(`/agents/${opts.id}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Identity deleted: ${opts.id}`);
      } catch (error: unknown) {
        handleApiError(error, output, 'Failed to delete identity');
      }
    });
}

function handleApiError(error: unknown, output: Output, context: string): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `am auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Identity not found.');
    } else {
      output.error(`${context}: ${error.message}`);
    }
  } else if (error instanceof Error) {
    output.error(`${context}: ${error.message}`);
  } else {
    output.error(context);
  }
  process.exit(1);
}
