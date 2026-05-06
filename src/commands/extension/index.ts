import { Command } from 'commander';
import { extensionStatusCommand } from './status.js';

export function extensionCommands(): Command {
  const cmd = new Command('extension').description('Manage Anima Chrome extension');
  cmd.addCommand(extensionStatusCommand());
  return cmd;
}
