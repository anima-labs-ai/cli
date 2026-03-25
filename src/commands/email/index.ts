import { Command } from 'commander';
import { sendEmailCommand } from './send.js';
import { listEmailsCommand } from './list.js';
import { getEmailCommand } from './get.js';
import { domainCommands } from './domains/index.js';

export function emailCommands(): Command {
  const cmd = new Command('email')
    .description('Send and manage emails');

  cmd.addCommand(sendEmailCommand());
  cmd.addCommand(listEmailsCommand());
  cmd.addCommand(getEmailCommand());
  cmd.addCommand(domainCommands());

  return cmd;
}
