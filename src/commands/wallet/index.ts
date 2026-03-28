import { Command } from 'commander';
import { walletBalanceCommand } from './balance.js';
import { walletPayCommand } from './pay.js';
import { walletTransactionsCommand } from './transactions.js';
import { walletFreezeCommand, walletUnfreezeCommand } from './freeze.js';

export function walletCommands(): Command {
  const cmd = new Command('wallet')
    .description('Manage agent wallets');

  cmd.addCommand(walletBalanceCommand());
  cmd.addCommand(walletPayCommand());
  cmd.addCommand(walletTransactionsCommand());
  cmd.addCommand(walletFreezeCommand());
  cmd.addCommand(walletUnfreezeCommand());

  return cmd;
}
