import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function getEmailCommand(): Command {
  return new Command('get')
    .description('Get email by ID')
    .argument('<id>', 'Email ID', requireNonEmptyArg('Email ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const message = await orpc.email.get({ id });

        if (globals.json) {
          output.json(message);
          return;
        }

        output.details([
          ['ID', message.id],
          ['Agent ID', message.agentId],
          ['Channel', message.channel],
          ['Direction', message.direction],
          ['Status', message.status],
          ['From', message.fromAddress],
          ['To', message.toAddress],
          ['Subject', message.subject ?? '-'],
          ['Labels', (message.labels ?? []).join(', ') || '-'],
          ['Thread ID', message.threadId ?? '-'],
          ['External ID', message.externalId ?? '-'],
          ['Sent At', message.sentAt ?? '-'],
          ['Received At', message.receivedAt ?? '-'],
          ['Created At', message.createdAt],
          ['Body', message.body],
          ['HTML Body', message.bodyHtml ?? '-'],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get email');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 404) {
      output.error('Email not found.');
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
