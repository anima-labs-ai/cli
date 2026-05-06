import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type MessageChannel = 'EMAIL' | 'SMS' | 'MMS' | 'VOICE';
type MessageDirection = 'INBOUND' | 'OUTBOUND';

interface ListOptions {
  agent?: string;
  channel?: MessageChannel;
  direction?: MessageDirection;
  limit?: string;
  cursor?: string;
}

export function listMessagesCommand(): Command {
  return new Command('list')
    .description('List messages across all channels')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--channel <channel>', 'Filter by channel (EMAIL, SMS, MMS, VOICE)', validateChannel)
    .option('--direction <dir>', 'Filter by direction (INBOUND, OUTBOUND)', validateDirection)
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.message.list({
          agentId: opts.agent,
          channel: opts.channel,
          direction: opts.direction,
          cursor: opts.cursor,
          limit: opts.limit ? Number(opts.limit) : undefined,
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
          ['ID', 'Channel', 'Direction', 'Status', 'From', 'To', 'Subject', 'Created At'],
          items.map((msg) => [
            msg.id,
            msg.channel,
            msg.direction,
            msg.status,
            msg.fromAddress,
            msg.toAddress,
            msg.subject ? msg.subject.substring(0, 40) : '-',
            msg.createdAt,
          ]),
        );

        if (result.pagination.nextCursor) {
          output.info(`Next cursor: ${result.pagination.nextCursor}`);
        }
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list messages');
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

function validateLimit(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return value;
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this resource.');
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
