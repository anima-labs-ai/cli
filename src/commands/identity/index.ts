import { Command } from 'commander';
import { createIdentityCommand } from './create.js';
import { listIdentitiesCommand } from './list.js';
import { getIdentityCommand } from './get.js';
import { updateIdentityCommand } from './update.js';
import { deleteIdentityCommand } from './delete.js';
import { rotateIdentityKeyCommand } from './rotate-key.js';
import { getDidCommand } from './did.js';
import { listCredentialsCommand } from './credentials.js';
import { getAgentCardCommand } from './card.js';

export function identityCommands(): Command {
  const cmd = new Command('identity')
    .alias('id')
    .description('Manage agent identities');

  cmd.addCommand(createIdentityCommand());
  cmd.addCommand(listIdentitiesCommand());
  cmd.addCommand(getIdentityCommand());
  cmd.addCommand(updateIdentityCommand());
  cmd.addCommand(deleteIdentityCommand());
  cmd.addCommand(rotateIdentityKeyCommand());
  cmd.addCommand(getDidCommand());
  cmd.addCommand(listCredentialsCommand());
  cmd.addCommand(getAgentCardCommand());

  return cmd;
}
