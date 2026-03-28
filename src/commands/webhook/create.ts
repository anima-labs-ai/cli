import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CreateWebhookOptions {
  url: string;
  events: string;
  secret?: string;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export function createWebhookCommand(): Command {
  return new Command('create')
    .description('Create a webhook')
    .requiredOption('--url <url>', 'Webhook endpoint URL')
    .requiredOption('--events <events>', 'Comma-separated list of events (e.g. email.received,email.sent)')
    .option('--secret <secret>', 'Webhook signing secret')
    .action(async function (this: Command) {
      const opts = this.opts<CreateWebhookOptions>();
      const globals = this.optsWithGlobals<CreateWebhookOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const body = {
        url: opts.url,
        events: opts.events.split(',').map((e) => e.trim()),
        ...(opts.secret !== undefined && { secret: opts.secret }),
      };

      try {
        const client = await requireAuth(globals);
        const result = await client.post<Webhook>('/api/v1/webhooks', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Webhook ID', result.id],
          ['URL', result.url],
          ['Events', result.events.join(', ')],
          ['Secret', result.secret ?? '(hidden)'],
          ['Status', result.status],
          ['Created At', result.createdAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to create webhook: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to create webhook: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
