import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';
import { validateLimit } from '../../../lib/args.js';

interface ListDraftsOptions {
  cursor?: string;
  limit?: string;
  agent?: string;
}

export function listDraftsCommand(): Command {
  return new Command('list')
    .description('List email drafts')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--agent <id>', 'Filter by agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<ListDraftsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.emailDraft.list({
          cursor: opts.cursor,
          limit: opts.limit ? Number(opts.limit) : undefined,
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        const items = result.items;
        if (items.length === 0) {
          output.info('No drafts found');
          return;
        }

        output.table(
          ['ID', 'Agent', 'To', 'Subject', 'Updated At'],
          items.map((draft) => [
            draft.id,
            draft.agentId,
            draft.to.length > 0 ? draft.to.join(', ') : '-',
            draft.subject ?? '-',
            draft.updatedAt,
          ]),
          {
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list drafts');
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
