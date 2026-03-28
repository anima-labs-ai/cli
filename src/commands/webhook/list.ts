import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: string;
  createdAt?: string;
}

interface ListWebhooksResponse {
  data: Webhook[];
}

export function listWebhooksCommand(): Command {
  return new Command('list')
    .description('List webhooks')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<ListWebhooksResponse>('/api/v1/webhooks');

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'URL', 'Events', 'Status', 'Created At'],
          result.data.map((wh) => [
            wh.id,
            wh.url,
            wh.events.join(', '),
            wh.status,
            wh.createdAt ?? '-',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list webhooks: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list webhooks: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
