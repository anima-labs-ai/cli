import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface BalanceOptions {
  agent: string;
}

export function walletBalanceCommand(): Command {
  return new Command('balance')
    .description('Get wallet balance for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<BalanceOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const wallet = await orpc.wallet.get({ agentId: opts.agent });

        if (globals.json) {
          output.json(wallet);
          return;
        }

        output.details([
          ['Wallet ID', wallet.id],
          ['Agent ID', wallet.agentId],
          ['Organization ID', wallet.orgId],
          ['DID', wallet.did ?? '-'],
          ['Balance', `${wallet.balance} ${wallet.currency}`],
          ['Status', wallet.status],
          ['Daily Limit', wallet.dailyLimit !== null ? `${wallet.dailyLimit} ${wallet.currency}` : 'None'],
          ['Monthly Limit', wallet.monthlyLimit !== null ? `${wallet.monthlyLimit} ${wallet.currency}` : 'None'],
          ['Spent Today', `${wallet.spentToday} ${wallet.currency}`],
          ['Spent This Month', `${wallet.spentThisMonth} ${wallet.currency}`],
          ['Total Spent', `${wallet.totalSpent} ${wallet.currency}`],
          ['Created', wallet.createdAt],
          ['Updated', wallet.updatedAt],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get wallet');
      }
    });
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
