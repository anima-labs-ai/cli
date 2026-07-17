import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function deleteInboxCommand(): Command {
  return new Command('delete')
    .description('Delete an inbox')
    .argument('<id>', 'Inbox ID', requireNonEmptyArg('Inbox ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.inbox.delete({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Inbox ${id} deleted`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to delete inbox', { statusMessages: { 404: 'Inbox not found.' } });
      }
    });
}
