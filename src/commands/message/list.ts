import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ListOptions {
  agent?: string;
  channel?: string;
  direction?: string;
  limit?: string;
  cursor?: string;
}

interface MessageItem {
  id: string;
  agentId: string;
  channel?: string;
  direction?: string;
  status?: string;
  fromAddress?: string;
  toAddress?: string;
  subject?: string;
  body?: string;
  createdAt?: string;
}

interface ListMessagesResponse {
  items: MessageItem[];
  pagination?: { nextCursor?: string | null; hasMore?: boolean };
}

export function listMessagesCommand(): Command {
  return new Command('list')
    .description('List messages across all channels')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--channel <channel>', 'Filter by channel (EMAIL, SMS, MMS)')
    .option('--direction <dir>', 'Filter by direction (INBOUND, OUTBOUND)')
    .option('--limit <number>', 'Page size (1-100, default 20)')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const params: Record<string, string> = {};
        if (opts.agent) params.agentId = opts.agent;
        if (opts.channel) params.channel = opts.channel.toUpperCase();
        if (opts.direction) params.direction = opts.direction.toUpperCase();
        if (opts.cursor) params.cursor = opts.cursor;
        if (opts.limit) {
          const parsed = Number.parseInt(opts.limit, 10);
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
            output.error('Limit must be an integer between 1 and 100.');
            process.exit(1);
          }
          params.limit = String(parsed);
        }

        const client = await requireAuth(globals);
        const result = await client.get<ListMessagesResponse>('/messages', params);

        if (globals.json) {
          output.json(result);
          return;
        }

        const items = result.items ?? [];
        if (items.length === 0) {
          output.info('No messages found');
          return;
        }

        output.table(
          ['ID', 'Channel', 'Direction', 'Status', 'From', 'To', 'Subject', 'Created At'],
          items.map((msg) => [
            msg.id,
            msg.channel ?? '-',
            msg.direction ?? '-',
            msg.status ?? '-',
            msg.fromAddress ?? '-',
            msg.toAddress ?? '-',
            msg.subject ? msg.subject.substring(0, 40) : '-',
            msg.createdAt ?? '-',
          ]),
        );

        if (result.pagination?.nextCursor) {
          output.info(`Next cursor: ${result.pagination.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list messages: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list messages: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
