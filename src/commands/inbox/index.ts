import { Command } from 'commander';
import { createInboxCommand } from './create.js';
import { getInboxCommand } from './get.js';
import { listInboxesCommand } from './list.js';
import { updateInboxCommand } from './update.js';
import { deleteInboxCommand } from './delete.js';

export function inboxCommands(): Command {
  const cmd = new Command('inbox')
    .description('Manage email inboxes');

  cmd.addCommand(createInboxCommand());
  cmd.addCommand(getInboxCommand());
  cmd.addCommand(listInboxesCommand());
  cmd.addCommand(updateInboxCommand());
  cmd.addCommand(deleteInboxCommand());

  return cmd;
}
