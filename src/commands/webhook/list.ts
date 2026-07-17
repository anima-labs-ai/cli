import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { validateLimit } from '../../lib/args.js';

interface ListWebhooksOptions {
  limit?: string;
  cursor?: string;
}

export function listWebhooksCommand(): Command {
  return new Command('list')
    .description('List webhooks')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command) {
      const opts = this.opts<ListWebhooksOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.webhook.list({
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'URL', 'Events', 'Active', 'Created At'],
          result.items.map((wh) => [
            wh.id,
            wh.url,
            wh.events.join(', '),
            wh.active ? 'Yes' : 'No',
            wh.createdAt,
          ]),
          {
            summary: `Returned ${result.items.length} webhooks.`,
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list webhooks');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to list webhooks.');
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
