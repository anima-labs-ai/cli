import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type IdentityStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

interface ListIdentitiesOptions {
  org: string;
  limit?: string;
  cursor?: string;
  status?: IdentityStatus;
  query?: string;
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
}

interface ListIdentitiesResponse {
  items: Identity[];
  nextCursor?: string;
  hasMore?: boolean;
  total?: number;
}

export function listIdentitiesCommand(): Command {
  return new Command('list')
    .description('List identities')
    .requiredOption('--org <orgId>', 'Organization ID')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--status <status>', 'Filter by status (ACTIVE|SUSPENDED|DELETED)', validateStatus)
    .option('--query <query>', 'Search query for name/slug/email')
    .action(async function (this: Command) {
      const opts = this.opts<ListIdentitiesOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const params: Record<string, string> = { orgId: opts.org };

        if (opts.limit) {
          params.limit = opts.limit;
        }

        if (opts.cursor) {
          params.cursor = opts.cursor;
        }

        if (opts.status) {
          params.status = opts.status;
        }

        if (opts.query) {
          params.query = opts.query;
        }

        const result = await client.get<ListIdentitiesResponse>('/agents', params);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Name', 'Slug', 'Email', 'Status', 'Org ID', 'Created At'],
          result.items.map((item) => [
            item.id,
            item.name,
            item.slug,
            item.email ?? '',
            item.status ?? '',
            item.orgId,
            item.createdAt ?? '',
          ]),
        );

        const pageSize = result.items.length;
        output.info(`Returned ${pageSize} identities${result.total !== undefined ? ` (total: ${result.total})` : ''}.`);
        output.info(`Has more: ${result.hasMore ? 'yes' : 'no'}`);
        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        handleApiError(error, output, 'Failed to list identities');
      }
    });
}

function validateStatus(value: string): IdentityStatus {
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'DELETED') {
    return value;
  }
  throw new InvalidArgumentError('status must be one of ACTIVE, SUSPENDED, DELETED');
}

function validateLimit(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return value;
}

function handleApiError(error: unknown, output: Output, context: string): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `am auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this organization.');
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
