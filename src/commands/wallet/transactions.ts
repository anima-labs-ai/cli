import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface TransactionsOptions {
  agent: string;
  limit?: string;
  cursor?: string;
  since?: string;
  until?: string;
}

export function walletTransactionsCommand(): Command {
  return new Command('transactions')
    .alias('txns')
    .description('List wallet transactions for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--since <iso8601>', 'Inclusive start of date range (ISO 8601)', validateIsoDate)
    .option('--until <iso8601>', 'Inclusive end of date range (ISO 8601)', validateIsoDate)
    .action(async function (this: Command) {
      const opts = this.opts<TransactionsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.wallet.transactions({
          agentId: opts.agent,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
          since: opts.since,
          until: opts.until,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        if (result.items.length === 0) {
          output.info('No transactions found');
          return;
        }

        output.table(
          ['ID', 'Amount', 'Protocol', 'Merchant', 'Description', 'Status', 'Created'],
          result.items.map((tx) => [
            tx.id,
            `${tx.amount} ${tx.currency}`,
            tx.protocol,
            tx.merchant ?? '-',
            tx.description ?? '-',
            tx.status,
            tx.createdAt,
          ]),
          {
            summary: `Returned ${result.items.length} transactions.`,
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list transactions');
      }
    });
}

function validateLimit(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return value;
}

function validateIsoDate(value: string): string {
  // ISO 8601 datetime quick-check; the server validates the canonical form.
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidArgumentError(`invalid ISO 8601 datetime: ${value}`);
  }
  return value;
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this wallet.');
    } else if (error.status === 404) {
      output.error('Wallet not found.');
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
