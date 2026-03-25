import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type TransactionStatus =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'DECLINED'
  | 'REVERSED'
  | 'EXPIRED';

interface TransactionsOptions {
  card?: string;
  agent?: string;
  status?: TransactionStatus;
  cursor?: string;
  limit?: number;
}

interface Transaction {
  id: string;
  cardId: string;
  agentId: string;
  status: string;
  amount: number;
  currency?: string;
  merchantName?: string;
  createdAt?: string;
}

interface ListTransactionsResponse {
  data: Transaction[];
  nextCursor?: string;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('Limit must be an integer between 1 and 100');
  }
  return parsed;
}

function parseStatus(value: string): TransactionStatus {
  const upper = value.toUpperCase();
  if (
    upper !== 'PENDING' &&
    upper !== 'PENDING_APPROVAL' &&
    upper !== 'APPROVED' &&
    upper !== 'DECLINED' &&
    upper !== 'REVERSED' &&
    upper !== 'EXPIRED'
  ) {
    throw new InvalidArgumentError(
      'Status must be PENDING, PENDING_APPROVAL, APPROVED, DECLINED, REVERSED, or EXPIRED',
    );
  }
  return upper;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function transactionsCommand(): Command {
  return new Command('transactions')
    .description('List card transactions')
    .option('--card <id>', 'Filter by card ID')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--status <status>', 'Filter by status', parseStatus)
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <n>', 'Page size (1-100)', parseLimit)
    .action(async function (this: Command) {
      const opts = this.opts<TransactionsOptions>();
      const globals = this.optsWithGlobals<TransactionsOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const query: Record<string, string> = {};

      if (opts.card !== undefined) {
        query.cardId = opts.card;
      }
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
        const result = await client.get<ListTransactionsResponse>('/api/v1/cards/transactions', query);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Card', 'Agent', 'Status', 'Amount', 'Currency', 'Merchant', 'Created At'],
          result.data.map((transaction) => [
            transaction.id,
            transaction.cardId,
            transaction.agentId,
            transaction.status,
            formatMoney(transaction.amount),
            transaction.currency ?? '-',
            transaction.merchantName ?? '-',
            transaction.createdAt ?? '-',
          ]),
        );

        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list transactions: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list transactions: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
