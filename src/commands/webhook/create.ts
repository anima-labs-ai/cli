import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CreateWebhookOptions {
  url: string;
  events: string;
  description?: string;
}

export function createWebhookCommand(): Command {
  return new Command('create')
    .description('Create a webhook')
    .requiredOption('--url <url>', 'Webhook endpoint URL')
    .requiredOption('--events <events>', 'Comma-separated list of events (e.g. email.received,email.sent)')
    .option('--description <description>', 'Optional human-readable label')
    .action(async function (this: Command) {
      const opts = this.opts<CreateWebhookOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const webhook = await orpc.webhook.create({
          url: opts.url,
          events: opts.events.split(',').map((e) => e.trim()),
          description: opts.description,
        });

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
          ['Created At', webhook.createdAt],
        ]);
        output.success(`Webhook created: ${webhook.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to create webhook');
      }
    });
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
