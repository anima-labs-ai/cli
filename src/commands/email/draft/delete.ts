import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';

export function deleteDraftCommand(): Command {
  return new Command('delete')
    .description('Delete a draft without sending it')
    .argument('<id>', 'Draft ID')
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
        handleOrpcError(error, output, 'Failed to delete draft');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Draft not found. It may have already been sent (send deletes the draft) or deleted.');
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
