import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { collectValue, validateLimit } from '../../lib/args.js';

type MessageChannel = 'EMAIL' | 'SMS' | 'MMS' | 'VOICE';
type MessageDirection = 'INBOUND' | 'OUTBOUND';
type MessageStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'BOUNCED'
  | 'BLOCKED'
  | 'PENDING_APPROVAL';

interface SearchOptions {
  agent?: string;
  channel?: MessageChannel;
  direction?: MessageDirection;
  status?: MessageStatus;
  label: string[];
  includeSpam?: boolean;
  limit?: string;
  cursor?: string;
}

export function searchMessagesCommand(): Command {
  return new Command('search')
    .description('Search messages by text query')
    .argument('<query>', 'Search query text')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--channel <channel>', 'Filter by channel (EMAIL, SMS, MMS, VOICE)', validateChannel)
    .option('--direction <dir>', 'Filter by direction (INBOUND, OUTBOUND)', validateDirection)
    .option('--status <status>', 'Filter by status', validateStatus)
    .option('--label <label>', 'Only messages carrying this label; repeat to require ALL. System: unread, read, archived, spam', collectValue, [])
    .option('--include-spam', 'Include messages flagged as spam on arrival (excluded by default)')
    .option('--limit <number>', 'Max results (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command, query: string) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.message.search({
          query,
          filters: {
            agentId: opts.agent,
            channel: opts.channel,
            direction: opts.direction,
            status: opts.status,
            labels: opts.label.length > 0 ? opts.label : undefined,
            includeSpam: opts.includeSpam,
          },
          pagination: {
            cursor: opts.cursor,
            limit: opts.limit ? Number(opts.limit) : 20,
          },
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        const items = result.items;
        if (items.length === 0) {
          output.info('No messages found');
          return;
        }

        output.table(
          ['ID', 'Channel', 'Direction', 'Status', 'From', 'To', 'Subject', 'Labels', 'Created At'],
          items.map((msg) => [
            msg.id,
            msg.channel,
            msg.direction,
            msg.status,
            msg.fromAddress,
            msg.toAddress,
            msg.subject ? msg.subject.substring(0, 40) : '-',
            (msg.labels ?? []).join(', ') || '-',
            msg.createdAt,
          ]),
        );

        if (result.pagination.nextCursor) {
          output.info(`Next cursor: ${result.pagination.nextCursor}`);
        }
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to search messages', { statusMessages: { 403: 'Forbidden: you do not have access to this resource.' } });
      }
    });
}

function validateChannel(value: string): MessageChannel {
  const upper = value.toUpperCase();
  if (upper === 'EMAIL' || upper === 'SMS' || upper === 'MMS' || upper === 'VOICE') {
    return upper;
  }
  throw new InvalidArgumentError('channel must be one of EMAIL, SMS, MMS, VOICE');
}

function validateDirection(value: string): MessageDirection {
  const upper = value.toUpperCase();
  if (upper === 'INBOUND' || upper === 'OUTBOUND') {
    return upper;
  }
  throw new InvalidArgumentError('direction must be one of INBOUND, OUTBOUND');
}

function validateStatus(value: string): MessageStatus {
  const upper = value.toUpperCase();
  if (
    upper === 'QUEUED' ||
    upper === 'SENT' ||
    upper === 'DELIVERED' ||
    upper === 'FAILED' ||
    upper === 'BOUNCED' ||
    upper === 'BLOCKED' ||
    upper === 'PENDING_APPROVAL'
  ) {
    return upper;
  }
  throw new InvalidArgumentError(
    'status must be one of QUEUED, SENT, DELIVERED, FAILED, BOUNCED, BLOCKED, PENDING_APPROVAL',
  );
}
