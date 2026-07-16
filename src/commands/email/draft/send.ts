import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../../lib/orpc.js';

export function sendDraftCommand(): Command {
  return new Command('send')
    .description('Send a draft — converts it to a real message and deletes the draft')
    .argument('<id>', 'Draft ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        // Atomic on the server: the draft becomes a Message (email.send
        // semantics — threading, scanning, limits) and the draft row is
        // deleted. The response is the new Message, not the draft.
        const message = await orpc.emailDraft.send({ id });

        if (globals.json) {
          output.json(message);
          return;
        }

        output.success(`Draft sent (message ${message.id}, status ${message.status})`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to send draft');
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
