import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface MessageResponse {
  id: string;
  agentId: string;
  channel?: string;
  direction?: string;
  status?: string;
  fromAddress?: string;
  toAddress?: string;
  subject?: string;
  body?: string;
  bodyHtml?: string;
  threadId?: string;
  externalId?: string;
  sentAt?: string;
  receivedAt?: string;
  createdAt?: string;
}

export function getMessageCommand(): Command {
  return new Command('get')
    .description('Get a message by ID')
    .argument('<id>', 'Message ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<MessageResponse>(`/messages/${id}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Agent ID', result.agentId],
          ['Channel', result.channel],
          ['Direction', result.direction],
          ['Status', result.status],
          ['From', result.fromAddress],
          ['To', result.toAddress],
          ['Subject', result.subject],
          ['Thread ID', result.threadId],
          ['External ID', result.externalId],
          ['Sent At', result.sentAt],
          ['Received At', result.receivedAt],
          ['Created At', result.createdAt],
          ['Body', result.body],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get message: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get message: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
