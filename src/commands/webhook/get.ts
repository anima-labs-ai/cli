import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function getWebhookCommand(): Command {
  return new Command('get')
    .description('Get webhook details')
    .argument('<id>', 'Webhook ID', requireNonEmptyArg('Webhook ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const webhook = await orpc.webhook.get({ id });

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
          ['Auth Header', webhook.authHeaderName ?? '-'],
          ['Rate Limit/min', webhook.rateLimitPerMinute != null ? String(webhook.rateLimitPerMinute) : '-'],
          ['Max Attempts', webhook.maxAttempts != null ? String(webhook.maxAttempts) : '-'],
          ['Consecutive Failures', String(webhook.consecutiveFailures)],
          ['Disabled Reason', webhook.disabledReason ?? '-'],
          ['Disabled At', webhook.disabledAt ?? '-'],
          ['Created At', webhook.createdAt],
          ['Updated At', webhook.updatedAt],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get webhook', { statusMessages: { 404: 'Webhook not found.' } });
      }
    });
}
