import { Command } from 'commander';
import { configSetCommand } from './set.js';
import { configGetCommand } from './get.js';
import { configListCommand } from './list.js';
import { configProfileCommand } from './profile.js';

export function configCommands(): Command {
  const cmd = new Command('config')
    .description('Manage CLI configuration and profiles');

  cmd.addCommand(configSetCommand());
  cmd.addCommand(configGetCommand());
  cmd.addCommand(configListCommand());
  cmd.addCommand(configProfileCommand());

  return cmd;
}
