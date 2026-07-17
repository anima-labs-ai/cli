import { Command } from 'commander';
import { listMessagesCommand } from './list.js';
import { getMessageCommand } from './get.js';
import { searchMessagesCommand } from './search.js';
import { labelMessageCommand } from './label.js';

export function messageCommand(): Command {
  return new Command('message')
    .description('Manage messages (email, SMS, MMS)')
    .addCommand(listMessagesCommand())
    .addCommand(getMessageCommand())
    .addCommand(searchMessagesCommand())
    .addCommand(labelMessageCommand());
}
