import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type CardStatus = 'ACTIVE' | 'FROZEN' | 'CANCELED';

interface ListCardsOptions {
  agent?: string;
  status?: CardStatus;
  cursor?: string;
  limit?: number;
}

interface SpendLimits {
  daily?: number;
  monthly?: number;
  perAuth?: number;
  weekly?: number;
  yearly?: number;
  lifetime?: number;
}

interface Card {
  id: string;
  agentId: string;
  label?: string;
  status: string;
  currency: string;
  spendLimits?: SpendLimits;
  createdAt?: string;
  updatedAt?: string;
}

interface ListCardsResponse {
  data: Card[];
  nextCursor?: string;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('Limit must be an integer between 1 and 100');
  }
  return parsed;
}

function parseStatus(value: string): CardStatus {
  const upper = value.toUpperCase();
  if (upper !== 'ACTIVE' && upper !== 'FROZEN' && upper !== 'CANCELED') {
    throw new InvalidArgumentError('Status must be ACTIVE, FROZEN, or CANCELED');
  }
  return upper;
}

function formatMoney(cents?: number): string {
  if (cents === undefined) {
    return '-';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function listCardsCommand(): Command {
  return new Command('list')
    .description('List cards')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--status <status>', 'Filter by status (ACTIVE|FROZEN|CANCELED)', parseStatus)
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <n>', 'Page size (1-100)', parseLimit)
    .action(async function (this: Command) {
      const opts = this.opts<ListCardsOptions>();
      const globals = this.optsWithGlobals<ListCardsOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const query: Record<string, string> = {};

      if (opts.agent !== undefined) {
        query.agentId = opts.agent;
      }
      if (opts.status !== undefined) {
        query.status = opts.status;
      }
      if (opts.cursor !== undefined) {
        query.cursor = opts.cursor;
      }
      if (opts.limit !== undefined) {
        query.limit = String(opts.limit);
      }

      try {
        const client = await requireAuth(globals);
        const result = await client.get<ListCardsResponse>('/api/v1/cards', query);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Agent', 'Label', 'Status', 'Currency', 'Daily Limit', 'Created At'],
          result.data.map((card) => [
            card.id,
            card.agentId,
            card.label ?? '-',
            card.status,
            card.currency,
            formatMoney(card.spendLimits?.daily),
            card.createdAt ?? '-',
          ]),
        );

        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list cards: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list cards: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
