import { Command } from 'commander';
import { listMessagesCommand } from './list.js';
import { getMessageCommand } from './get.js';
import { searchMessagesCommand } from './search.js';

export function messageCommand(): Command {
  return new Command('message')
    .description('Manage messages (email, SMS, MMS)')
    .addCommand(listMessagesCommand())
    .addCommand(getMessageCommand())
    .addCommand(searchMessagesCommand());
}
