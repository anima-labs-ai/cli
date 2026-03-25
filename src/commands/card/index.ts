import { Command } from 'commander';
import { createCardCommand } from './create.js';
import { listCardsCommand } from './list.js';
import { getCardCommand } from './get.js';
import { updateCardCommand } from './update.js';
import { deleteCardCommand } from './delete.js';
import { transactionsCommand } from './transactions.js';
import { killSwitchCommand } from './kill-switch.js';

export function cardCommands(): Command {
  const cmd = new Command('card')
    .description('Manage virtual payment cards');

  cmd.addCommand(createCardCommand());
  cmd.addCommand(listCardsCommand());
  cmd.addCommand(getCardCommand());
  cmd.addCommand(updateCardCommand());
  cmd.addCommand(deleteCardCommand());
  cmd.addCommand(transactionsCommand());
  cmd.addCommand(killSwitchCommand());

  return cmd;
}
