import { Command } from 'commander';
import { securityEventsCommand } from './events.js';
import { securityScanCommand } from './scan.js';

export function securityCommands(): Command {
  const cmd = new Command('security')
    .description('Security monitoring and scanning');

  cmd.addCommand(securityEventsCommand());
  cmd.addCommand(securityScanCommand());

  return cmd;
}
