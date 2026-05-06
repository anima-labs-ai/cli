import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type IdentityStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

interface ListIdentitiesOptions {
  org: string;
  limit?: string;
  cursor?: string;
  status?: IdentityStatus;
  query?: string;
}

export function listIdentitiesCommand(): Command {
  return new Command('list')
    .description('List identities')
    .requiredOption('--org <orgId>', 'Organization ID')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--status <status>', 'Filter by status (ACTIVE|SUSPENDED|DELETED)', validateStatus)
    .option('--query <query>', 'Search query for name/slug')
    .action(async function (this: Command) {
      const opts = this.opts<ListIdentitiesOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.agent.list({
          orgId: opts.org,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
          status: opts.status,
          query: opts.query,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Name', 'Slug', 'Status', 'Org ID', 'Created At'],
          result.items.map((item) => [
            item.id,
            item.name,
            item.slug,
            item.status,
            item.orgId,
            item.createdAt,
          ]),
          {
            summary: `Returned ${result.items.length} identities.`,
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list identities');
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

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
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
