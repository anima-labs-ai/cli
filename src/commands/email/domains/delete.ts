import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

export function deleteDomainCommand(): Command {
  return new Command('delete')
    .description('Delete a sending domain')
    .argument('<id>', 'Domain ID', requireNonEmptyArg('Domain ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.delete({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Deleted domain ${id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to delete domain', { statusMessages: { 404: 'Domain not found.' } });
      }
    });
}
