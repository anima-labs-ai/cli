import { Command } from 'commander';
import { discoverCommand } from './discover.js';
import { sendTaskCommand } from './send.js';
import { listTasksCommand } from './tasks.js';

export function a2aCommands(): Command {
  const cmd = new Command('a2a')
    .description('Agent-to-Agent (A2A) protocol commands');

  cmd.addCommand(discoverCommand());
  cmd.addCommand(sendTaskCommand());
  cmd.addCommand(listTasksCommand());

  return cmd;
}
