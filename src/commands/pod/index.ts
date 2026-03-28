import { Command } from 'commander';
import { createPodCommand } from './create.js';
import { listPodsCommand } from './list.js';
import { podUsageCommand } from './use.js';

export function podCommands(): Command {
  const cmd = new Command('pod')
    .description('Manage compute pods');

  cmd.addCommand(createPodCommand());
  cmd.addCommand(listPodsCommand());
  cmd.addCommand(podUsageCommand());

  return cmd;
}
