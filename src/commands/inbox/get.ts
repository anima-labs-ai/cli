import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

export function getInboxCommand(): Command {
  return new Command('get')
    .description('Get inbox by ID')
    .argument('<id>', 'Inbox ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const inbox = await orpc.inbox.get({ id });

        if (globals.json) {
          output.json(inbox);
          return;
        }

        output.details([
          ['Inbox ID', inbox.id],
          ['Email', inbox.email],
          ['Domain', inbox.domain],
          ['Local Part', inbox.localPart],
          ['Display Name', inbox.displayName ?? '-'],
          ['Agent ID', inbox.agentId ?? '-'],
          ['Created At', inbox.createdAt],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get inbox');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Inbox not found.');
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
