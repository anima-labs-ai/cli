import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { boundedInt } from '../../lib/args.js';

interface CreateWebhookOptions {
  url: string;
  events: string;
  description?: string;
  authConfig?: string;
  rateLimitPerMinute?: number;
  maxAttempts?: number;
}

export function createWebhookCommand(): Command {
  return new Command('create')
    .description('Create a webhook')
    .requiredOption('--url <url>', 'Webhook endpoint URL')
    .requiredOption('--events <events>', 'Comma-separated list of events (e.g. email.received,email.sent)')
    .option('--description <description>', 'Optional human-readable label')
    .option('--auth-config <json>', 'Auth the platform presents to your endpoint, as JSON (types: none|bearer|basic|custom_header), e.g. {"type":"bearer","token":"..."}')
    .option('--rate-limit-per-minute <n>', 'Max deliveries per minute to this endpoint', boundedInt('--rate-limit-per-minute', 1))
    .option('--max-attempts <n>', 'Max delivery attempts before dead-lettering (default 3)', boundedInt('--max-attempts', 1, 10))
    .action(async function (this: Command) {
      const opts = this.opts<CreateWebhookOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const payload: Parameters<typeof orpc.webhook.create>[0] = {
          url: opts.url,
          events: opts.events.split(',').map((e) => e.trim()),
          description: opts.description,
        };
        if (opts.authConfig) {
          try {
            payload.authConfig = JSON.parse(opts.authConfig);
          } catch {
            output.fatal('--auth-config must be valid JSON, e.g. {"type":"bearer","token":"..."}');
          }
        }
        if (opts.rateLimitPerMinute !== undefined) {
          payload.rateLimitPerMinute = opts.rateLimitPerMinute;
        }
        if (opts.maxAttempts !== undefined) {
          payload.maxAttempts = opts.maxAttempts;
        }
        const webhook = await orpc.webhook.create(payload);

        if (globals.json) {
          output.json(webhook);
          return;
        }

        output.details([
          ['Webhook ID', webhook.id],
          ['Organization ID', webhook.orgId],
          ['URL', webhook.url],
          ['Events', webhook.events.join(', ')],
          ['Active', webhook.active ? 'Yes' : 'No'],
          ['Description', webhook.description ?? '-'],
          ['Auth', webhook.authType && webhook.authType !== 'NONE' ? webhook.authType : '-'],
          ['Rate Limit/min', webhook.rateLimitPerMinute != null ? String(webhook.rateLimitPerMinute) : '-'],
          ['Max Attempts', webhook.maxAttempts != null ? String(webhook.maxAttempts) : '-'],
          ['Created At', webhook.createdAt],
        ]);
        output.success(`Webhook created: ${webhook.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to create webhook', { statusMessages: { 403: 'Forbidden: you do not have access to create webhooks here.' } });
      }
    });
}

