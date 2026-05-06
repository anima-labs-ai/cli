import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

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
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.listTransactions({
          cardId: opts.card,
          agentId: opts.agent,
          status: opts.status,
          cursor: opts.cursor,
          limit: opts.limit ?? 20,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Card', 'Status', 'Amount', 'Currency', 'Merchant', 'Created At'],
          result.items.map((transaction) => [
            transaction.id,
            transaction.cardId,
            transaction.status,
            formatMoney(transaction.amountCents),
            transaction.currency,
            transaction.merchantName ?? '-',
            transaction.createdAt,
          ]),
        );

        if (result.cursor) {
          output.info(`Next cursor: ${result.cursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list transactions: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list transactions: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
