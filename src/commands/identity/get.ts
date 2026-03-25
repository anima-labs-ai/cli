import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface GetIdentityOptions {
  id: string;
}

interface Identity {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  email?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: unknown;
}

export function getIdentityCommand(): Command {
  return new Command('get')
    .description('Get an identity by ID')
    .requiredOption('--id <id>', 'Identity ID')
    .action(async function (this: Command) {
      const opts = this.opts<GetIdentityOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<Identity>(`/api/v1/agents/${opts.id}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Organization ID', result.orgId],
          ['Name', result.name],
          ['Slug', result.slug],
          ['Email', result.email],
          ['Status', result.status],
          ['Created At', result.createdAt],
          ['Updated At', result.updatedAt],
          ['Metadata', result.metadata ? JSON.stringify(result.metadata) : undefined],
        ]);
      } catch (error: unknown) {
        handleApiError(error, output, 'Failed to get identity');
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
