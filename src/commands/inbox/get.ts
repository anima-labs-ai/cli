import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function getInboxCommand(): Command {
  return new Command('get')
    .description('Get inbox by ID')
    .argument('<id>', 'Inbox ID', requireNonEmptyArg('Inbox ID'))
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
        handleOrpcError(error, output, 'Failed to get inbox', { statusMessages: { 404: 'Inbox not found.' } });
      }
    });
}
