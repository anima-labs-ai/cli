import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface BalanceOptions {
  agent: string;
}

interface WalletResponse {
  id: string;
  agentId: string;
  address: string;
  currency: string;
  balance: number;
  status: string;
  spendLimitDaily: number | null;
  spendLimitMonthly: number | null;
  createdAt: string;
  updatedAt: string;
}

export function walletBalanceCommand(): Command {
  return new Command('balance')
    .description('Get wallet balance for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<BalanceOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<WalletResponse>(`/agents/${opts.agent}/wallet`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Wallet ID', result.id],
          ['Agent ID', result.agentId],
          ['Address', result.address],
          ['Balance', `${result.balance} ${result.currency}`],
          ['Status', result.status],
          ['Daily Limit', result.spendLimitDaily !== null ? String(result.spendLimitDaily) : 'None'],
          ['Monthly Limit', result.spendLimitMonthly !== null ? String(result.spendLimitMonthly) : 'None'],
          ['Created', result.createdAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get wallet: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
