import { Command } from 'commander';
import { sendEmailCommand } from './send.js';
import { listEmailsCommand } from './list.js';
import { getEmailCommand } from './get.js';
import { searchEmailsCommand } from './search.js';
import { draftCommands } from './draft/index.js';
import { domainCommands } from './domains/index.js';

export function emailCommands(): Command {
  const cmd = new Command('email')
    .description('Send and manage emails');

  cmd.addCommand(sendEmailCommand());
  cmd.addCommand(listEmailsCommand());
  cmd.addCommand(getEmailCommand());
  cmd.addCommand(searchEmailsCommand());
  cmd.addCommand(draftCommands());
  cmd.addCommand(domainCommands());

  return cmd;
}
