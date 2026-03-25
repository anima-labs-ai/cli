import { Command } from 'commander';
import { installExtensionCommand } from './install.js';
import { extensionStatusCommand } from './status.js';

export function extensionCommands(): Command {
  const cmd = new Command('extension').description('Manage Anima Chrome extension');
  cmd.addCommand(installExtensionCommand());
  cmd.addCommand(extensionStatusCommand());
  return cmd;
}
