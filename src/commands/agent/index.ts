import { Command } from 'commander';
import { createIdentityCommand } from './create.js';
import { listIdentitiesCommand } from './list.js';
import { useIdentityCommand } from './use.js';
import { getIdentityCommand } from './get.js';
import { updateIdentityCommand } from './update.js';
import { deleteIdentityCommand } from './delete.js';
import { rotateIdentityKeyCommand } from './rotate-key.js';
import { getDidCommand } from './did.js';
import { listCredentialsCommand } from './credentials.js';
import { getAgentCardCommand } from './card.js';

export function agentCommands(): Command {
  // `identity` and `id` stay as aliases. The command was `identity` through
  // 0.6.x and is in published docs, skill manifests and users' scripts;
  // dropping the old name to fix a naming inconsistency would break those for
  // no benefit they can see.
  const cmd = new Command('agent')
    .aliases(['identity', 'id'])
    .description('Manage agents');

  cmd.addCommand(createIdentityCommand());
  cmd.addCommand(listIdentitiesCommand());
  cmd.addCommand(useIdentityCommand());
  cmd.addCommand(getIdentityCommand());
  cmd.addCommand(updateIdentityCommand());
  cmd.addCommand(deleteIdentityCommand());
  cmd.addCommand(rotateIdentityKeyCommand());
  cmd.addCommand(getDidCommand());
  cmd.addCommand(listCredentialsCommand());
  cmd.addCommand(getAgentCardCommand());

  return cmd;
}
