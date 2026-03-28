import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface TransactionsOptions {
  agent: string;
  status?: string;
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  from: string | null;
  to: string | null;
  memo: string | null;
  status: string;
  createdAt: string;
}

interface TransactionsResponse {
  items: WalletTransaction[];
}

export function walletTransactionsCommand(): Command {
  return new Command('transactions')
    .alias('txns')
    .description('List wallet transactions for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--status <status>', 'Filter by transaction status')
    .action(async function (this: Command) {
      const opts = this.opts<TransactionsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const query: Record<string, string> = {};
        if (opts.status) query.status = opts.status;

        const client = await requireAuth(globals);
        const response = await client.get<TransactionsResponse>(
          `/api/v1/agents/${opts.agent}/wallet/transactions`,
          query,
        );

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          output.info('No transactions found');
          return;
        }

        output.table(
          ['ID', 'Type', 'Amount', 'From', 'To', 'Status', 'Created'],
          response.items.map((tx) => [
            tx.id,
            tx.type,
            `${tx.amount} ${tx.currency}`,
            tx.from ?? '-',
            tx.to ?? '-',
            tx.status,
            tx.createdAt,
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list transactions: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
