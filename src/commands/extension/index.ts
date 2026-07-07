import { Command } from 'commander';
import { extensionStatusCommand } from './status.js';
import { extensionConnectCommand } from './connect.js';

export function extensionCommands(): Command {
  const cmd = new Command('extension').description('Manage Anima Chrome extension');
  cmd.addCommand(extensionStatusCommand());
  cmd.addCommand(extensionConnectCommand());
  return cmd;
}
