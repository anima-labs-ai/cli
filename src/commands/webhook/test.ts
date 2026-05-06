import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

export function testWebhookCommand(): Command {
  return new Command('test')
    .description('Send a test event to a webhook')
    .argument('<id>', 'Webhook ID')
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
        handleOrpcError(error, output, 'Failed to test webhook');
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
