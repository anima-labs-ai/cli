import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

export function deleteDraftCommand(): Command {
  return new Command('delete')
    .description('Delete a draft without sending it')
    .argument('<id>', 'Draft ID', requireNonEmptyArg('Draft ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const draft = await orpc.emailDraft.delete({ id });

        if (globals.json) {
          output.json(draft);
          return;
        }

        output.success(`Deleted draft ${draft.id}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to delete draft', { statusMessages: { 404: 'Draft not found. It may have already been sent (send deletes the draft) or deleted.' } });
      }
    });
}
