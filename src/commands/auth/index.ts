import { Command } from 'commander';
import { loginCommand } from './login.js';
import { logoutCommand } from './logout.js';
import { whoamiCommand } from './whoami.js';

export function authCommands(): Command {
  const cmd = new Command('auth')
    .description('Authentication and session management');

  cmd.addCommand(loginCommand());
  cmd.addCommand(logoutCommand());
  cmd.addCommand(whoamiCommand());

  return cmd;
}
