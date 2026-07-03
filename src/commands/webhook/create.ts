import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CreateWebhookOptions {
  url: string;
  events: string;
  description?: string;
  authConfig?: string;
  rateLimitPerMinute?: string;
  maxAttempts?: string;
}

export function createWebhookCommand(): Command {
  return new Command('create')
    .description('Create a webhook')
    .requiredOption('--url <url>', 'Webhook endpoint URL')
    .requiredOption('--events <events>', 'Comma-separated list of events (e.g. email.received,email.sent)')
    .option('--description <description>', 'Optional human-readable label')
    .option('--auth-config <json>', 'Auth the platform presents to your endpoint, as JSON (types: none|bearer|basic|custom_header), e.g. {"type":"bearer","token":"..."}')
    .option('--rate-limit-per-minute <n>', 'Max deliveries per minute to this endpoint', validateRateLimit)
    .option('--max-attempts <n>', 'Max delivery attempts before dead-lettering (default 3)', validateMaxAttempts)
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
            output.error('--auth-config must be valid JSON, e.g. {"type":"bearer","token":"..."}');
            process.exit(1);
          }
        }
        if (opts.rateLimitPerMinute !== undefined) {
          payload.rateLimitPerMinute = Number(opts.rateLimitPerMinute);
        }
        if (opts.maxAttempts !== undefined) {
          payload.maxAttempts = Number(opts.maxAttempts);
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
        handleOrpcError(error, output, 'Failed to create webhook');
      }
    });
}

function validateRateLimit(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('--rate-limit-per-minute must be a positive integer');
  }
  return value;
}

function validateMaxAttempts(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new InvalidArgumentError('--max-attempts must be an integer between 1 and 10');
  }
  return value;
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to create webhooks here.');
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
