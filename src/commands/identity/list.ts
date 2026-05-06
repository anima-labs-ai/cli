import { Command, InvalidArgumentError } from 'commander';
import { type GlobalOptions } from '../../lib/auth.js';
import { resolveConfigValue } from '../../lib/config.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

type IdentityStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

interface ListIdentitiesOptions {
  org?: string;
  limit?: string;
  cursor?: string;
  status?: IdentityStatus;
  query?: string;
}

export function listIdentitiesCommand(): Command {
  return new Command('list')
    .description(
      'List identities. Defaults to all orgs you belong to; pass --org or set a default with `am org switch` to filter.',
    )
    .option(
      '--org <orgId>',
      'Filter to one organization (omit to list across all your orgs)',
    )
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

        // Resolve effective org filter:
        //   1. --org flag (explicit per-invocation)
        //   2. defaultOrg from config (set via `am org switch`)
        //   3. undefined → cross-org via /me/agents
        const explicitOrg = opts.org;
        const inheritedOrg = explicitOrg
          ? undefined
          : await resolveConfigValue('defaultOrg');
        const orgFilter = explicitOrg ?? inheritedOrg;

        const limit = opts.limit ? Number(opts.limit) : undefined;
        const result = orgFilter
          ? await orpc.agent.list({
              orgId: orgFilter,
              limit,
              cursor: opts.cursor,
              status: opts.status,
              query: opts.query,
            })
          : await orpc.me.listAgents({
              limit,
              cursor: opts.cursor,
              status: opts.status,
              query: opts.query,
            });

        if (globals.json) {
          output.json(result);
          return;
        }

        const scope = orgFilter
          ? `org ${orgFilter}${explicitOrg ? '' : ' (default)'}`
          : 'all your orgs';
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
            summary: `Returned ${result.items.length} identities from ${scope}.`,
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
    } else if (error.code === 'USER_AUTH_REQUIRED') {
      output.error(
        'Cross-org listing requires user authentication (Clerk session or OAuth). Run `am auth login --web`, or pass --org explicitly when using an API key.',
      );
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
