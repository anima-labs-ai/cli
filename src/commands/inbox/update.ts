import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

interface UpdateInboxOptions {
  displayName?: string;
  clearDisplayName?: boolean;
  agent?: string;
  unlinkAgent?: boolean;
}

export function updateInboxCommand(): Command {
  return new Command('update')
    .description('Update an inbox')
    .argument('<id>', 'Inbox ID', requireNonEmptyArg('Inbox ID'))
    .option('--display-name <name>', 'New display name (max 128 characters)')
    .option('--clear-display-name', 'Clear the display name')
    .option('--agent <id>', 'Agent ID to associate with the inbox')
    .option('--unlink-agent', 'Remove the agent association')
    .action(async function (this: Command, id: string) {
      const opts = this.opts<UpdateInboxOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      if (opts.displayName !== undefined && opts.clearDisplayName) {
        output.fatal('--display-name and --clear-display-name are mutually exclusive.');
      }
      if (opts.agent !== undefined && opts.unlinkAgent) {
        output.fatal('--agent and --unlink-agent are mutually exclusive.');
      }
      if (
        opts.displayName === undefined &&
        !opts.clearDisplayName &&
        opts.agent === undefined &&
        !opts.unlinkAgent
      ) {
        output.fatal('Nothing to update. Pass --display-name, --clear-display-name, --agent, or --unlink-agent.');
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const payload: Parameters<typeof orpc.inbox.update>[0] = { id };
        if (opts.clearDisplayName) {
          payload.displayName = null;
        } else if (opts.displayName !== undefined) {
          payload.displayName = opts.displayName;
        }
        if (opts.unlinkAgent) {
          payload.agentId = null;
        } else if (opts.agent !== undefined) {
          payload.agentId = opts.agent;
        }
        const inbox = await orpc.inbox.update(payload);

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
        output.success(`Inbox updated: ${inbox.email}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to update inbox', { statusMessages: { 404: 'Inbox not found.' } });
      }
    });
}
