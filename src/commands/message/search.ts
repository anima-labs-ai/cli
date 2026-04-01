import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface SearchOptions {
  agent?: string;
  channel?: string;
  direction?: string;
  status?: string;
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

interface SearchResponse {
  items: MessageItem[];
  pagination?: { nextCursor?: string | null; hasMore?: boolean };
}

export function searchMessagesCommand(): Command {
  return new Command('search')
    .description('Search messages by text query')
    .argument('<query>', 'Search query text')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--channel <channel>', 'Filter by channel (EMAIL, SMS, MMS)')
    .option('--direction <dir>', 'Filter by direction (INBOUND, OUTBOUND)')
    .option('--status <status>', 'Filter by status')
    .option('--limit <number>', 'Max results (1-100, default 20)')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command, query: string) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const payload: Record<string, unknown> = { query };
        const filters: Record<string, string> = {};
        if (opts.agent) filters.agentId = opts.agent;
        if (opts.channel) filters.channel = opts.channel.toUpperCase();
        if (opts.direction) filters.direction = opts.direction.toUpperCase();
        if (opts.status) filters.status = opts.status;
        if (Object.keys(filters).length > 0) payload.filters = filters;

        const pagination: Record<string, unknown> = {};
        if (opts.cursor) pagination.cursor = opts.cursor;
        if (opts.limit) {
          const parsed = Number.parseInt(opts.limit, 10);
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
            output.error('Limit must be an integer between 1 and 100.');
            process.exit(1);
          }
          pagination.limit = parsed;
        }
        if (Object.keys(pagination).length > 0) payload.pagination = pagination;

        const client = await requireAuth(globals);
        const result = await client.post<SearchResponse>('/messages/search', payload);

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
          output.error(`Failed to search messages: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to search messages: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
