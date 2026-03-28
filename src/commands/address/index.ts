import { Command } from 'commander';
import { createAddressCommand } from './create.js';
import { listAddressesCommand } from './list.js';
import { validateAddressCommand } from './validate.js';

export function addressCommands(): Command {
  const cmd = new Command('address')
    .description('Manage agent addresses');

  cmd.addCommand(createAddressCommand());
  cmd.addCommand(listAddressesCommand());
  cmd.addCommand(validateAddressCommand());

  return cmd;
}
