import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function deleteWebhookCommand(): Command {
  return new Command('delete')
    .description('Delete a webhook')
    .argument('<id>', 'Webhook ID', requireNonEmptyArg('Webhook ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.webhook.delete({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Webhook ${id} deleted`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to delete webhook', { statusMessages: { 404: 'Webhook not found.' } });
      }
    });
}
