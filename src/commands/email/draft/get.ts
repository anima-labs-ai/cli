import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';
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
        handleOrpcError(error, output, 'Failed to get draft');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Draft not found. It may have been sent (send deletes the draft) or deleted.');
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
