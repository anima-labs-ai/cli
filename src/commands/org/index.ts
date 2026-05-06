import { Command } from 'commander';
import { listOrgsCommand } from './list.js';
import { switchOrgCommand } from './switch.js';

export function orgCommands(): Command {
  const cmd = new Command('org').description('Manage organizations');
  cmd.addCommand(listOrgsCommand());
  cmd.addCommand(switchOrgCommand());
  return cmd;
}
