import { Command } from 'commander';
import { searchPhoneNumbersCommand } from './search.js';
import { provisionPhoneNumberCommand } from './provision.js';
import { listPhoneNumbersCommand } from './list.js';
import { releasePhoneNumberCommand } from './release.js';
import { sendSmsCommand } from './send-sms.js';

export function phoneCommands(): Command {
  const cmd = new Command('phone')
    .description('Manage phone numbers and SMS');

  cmd.addCommand(searchPhoneNumbersCommand());
  cmd.addCommand(provisionPhoneNumberCommand());
  cmd.addCommand(listPhoneNumbersCommand());
  cmd.addCommand(releasePhoneNumberCommand());
  cmd.addCommand(sendSmsCommand());

  return cmd;
}
