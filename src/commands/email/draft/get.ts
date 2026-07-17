import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { formatDraftDetails } from './format.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

export function getDraftCommand(): Command {
  return new Command('get')
    .description('Get a draft by ID')
    .argument('<id>', 'Draft ID', requireNonEmptyArg('Draft ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const draft = await orpc.emailDraft.get({ id });

        if (globals.json) {
          output.json(draft);
          return;
        }

        output.details(formatDraftDetails(draft));
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get draft', { statusMessages: { 404: 'Draft not found. It may have been sent (send deletes the draft) or deleted.' } });
      }
    });
}
