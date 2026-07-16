import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CreateInboxOptions {
  username?: string;
  domain?: string;
  displayName?: string;
  agent?: string;
}

export function createInboxCommand(): Command {
  return new Command('create')
    .description('Create an inbox')
    .option('--username <username>', 'Local part of the inbox address (letters, numbers, dots, hyphens, underscores)')
    .option('--domain <domain>', 'Domain for the inbox address (default domain if omitted)')
    .option('--display-name <name>', 'Human-readable display name (max 128 characters)')
    .option('--agent <id>', 'Agent ID to associate with the inbox')
    .action(async function (this: Command) {
      const opts = this.opts<CreateInboxOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const inbox = await orpc.inbox.create({
          // The server normalizes usernames to lowercase; do it client-side
          // too (matching `email domains add`) so the payload is what sticks.
          username: opts.username?.trim().toLowerCase(),
          domain: opts.domain,
          displayName: opts.displayName,
          agentId: opts.agent,
        });

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
        output.success(`Inbox created: ${inbox.email}`);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to create inbox');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 409) {
      output.error('Inbox address already exists. Choose a different username or domain.');
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
