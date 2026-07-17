import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function testWebhookCommand(): Command {
  return new Command('test')
    .description('Send a test event to a webhook')
    .argument('<id>', 'Webhook ID', requireNonEmptyArg('Webhook ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.webhook.test({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Webhook ${id} test dispatched`);
        output.details([
          ['Delivery ID', result.deliveryId],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to test webhook', { statusMessages: { 404: 'Webhook not found.' } });
      }
    });
}
