import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { requireNonEmptyArg, validateLimit } from '../../lib/args.js';

interface DeliveriesOptions {
  limit?: string;
  cursor?: string;
}

export function webhookDeliveriesCommand(): Command {
  return new Command('deliveries')
    .description('List webhook delivery history')
    .argument('<id>', 'Webhook ID', requireNonEmptyArg('Webhook ID'))
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command, id: string) {
      const opts = this.opts<DeliveriesOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.webhook.listDeliveries({
          webhookId: id,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Event', 'Status', 'Status Code', 'Attempts', 'Created At'],
          result.items.map((d) => [
            d.id,
            d.event,
            d.status,
            d.statusCode !== null ? String(d.statusCode) : '-',
            `${d.attempts}/${d.maxAttempts}`,
            d.createdAt,
          ]),
          {
            summary: `Returned ${result.items.length} deliveries.`,
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list deliveries');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Webhook not found.');
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
