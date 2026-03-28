import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface DeliveriesOptions {
  limit?: number;
  cursor?: string;
}

interface Delivery {
  id: string;
  event: string;
  statusCode?: number;
  success: boolean;
  timestamp?: string;
  duration?: number;
}

interface DeliveriesResponse {
  data: Delivery[];
  nextCursor?: string;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('Limit must be an integer between 1 and 100');
  }
  return parsed;
}

export function webhookDeliveriesCommand(): Command {
  return new Command('deliveries')
    .description('List webhook delivery history')
    .argument('<id>', 'Webhook ID')
    .option('--limit <n>', 'Page size (1-100)', parseLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command, id: string) {
      const opts = this.opts<DeliveriesOptions>();
      const globals = this.optsWithGlobals<DeliveriesOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const query: Record<string, string> = {};
      if (opts.limit !== undefined) {
        query.limit = String(opts.limit);
      }
      if (opts.cursor !== undefined) {
        query.cursor = opts.cursor;
      }

      try {
        const client = await requireAuth(globals);
        const result = await client.get<DeliveriesResponse>(`/api/v1/webhooks/${id}/deliveries`, query);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Event', 'Status Code', 'Success', 'Duration', 'Timestamp'],
          result.data.map((d) => [
            d.id,
            d.event,
            d.statusCode !== undefined ? String(d.statusCode) : '-',
            d.success ? 'Yes' : 'No',
            d.duration !== undefined ? `${d.duration}ms` : '-',
            d.timestamp ?? '-',
          ]),
        );

        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list deliveries: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list deliveries: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
