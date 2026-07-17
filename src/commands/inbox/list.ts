import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { validateLimit } from '../../lib/args.js';

interface ListInboxesOptions {
  cursor?: string;
  limit?: string;
  query?: string;
}

export function listInboxesCommand(): Command {
  return new Command('list')
    .description('List inboxes')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--query <text>', 'Filter inboxes by email or display name')
    .action(async function (this: Command) {
      const opts = this.opts<ListInboxesOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.inbox.list({
          cursor: opts.cursor,
          limit: opts.limit ? Number(opts.limit) : undefined,
          query: opts.query,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        const items = result.items ?? [];
        if (items.length === 0) {
          output.info('No inboxes found');
          return;
        }

        output.table(
          ['ID', 'Email', 'Display Name', 'Agent', 'Created At'],
          items.map((inbox) => [
            inbox.id,
            inbox.email,
            inbox.displayName ?? '-',
            inbox.agentId ?? '-',
            inbox.createdAt,
          ]),
          {
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list inboxes');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
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
