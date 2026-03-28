import { Command } from 'commander';
import { registerAgentCommand } from './register.js';
import { searchRegistryCommand } from './search.js';
import { lookupAgentCommand } from './lookup.js';

export function registryCommands(): Command {
  const cmd = new Command('registry')
    .description('Manage the agent registry');

  cmd.addCommand(registerAgentCommand());
  cmd.addCommand(searchRegistryCommand());
  cmd.addCommand(lookupAgentCommand());

  return cmd;
}
