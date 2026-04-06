import { Command } from 'commander';
import { provisionCommand } from './provision.js';
import { deprovisionCommand } from './deprovision.js';
import { statusCommand } from './status.js';
import { syncCommand } from './sync.js';
import { storeCommand } from './store.js';
import { getCommand } from './get.js';
import { listCommand } from './list.js';
import { searchCommand } from './search.js';
import { deleteCommand } from './delete.js';
import { generateCommand } from './generate.js';
import { totpCommand } from './totp.js';
import { shareCommand } from './share.js';
import { tokenCommand } from './token.js';
import { injectCommand } from './inject.js';
import { redactCommand } from './redact.js';

export function vaultCommands(): Command {
  const cmd = new Command('vault')
    .description('Manage password vault credentials');

  cmd.addCommand(provisionCommand());
  cmd.addCommand(deprovisionCommand());
  cmd.addCommand(statusCommand());
  cmd.addCommand(syncCommand());
  cmd.addCommand(storeCommand());
  cmd.addCommand(getCommand());
  cmd.addCommand(listCommand());
  cmd.addCommand(searchCommand());
  cmd.addCommand(deleteCommand());
  cmd.addCommand(generateCommand());
  cmd.addCommand(totpCommand());
  cmd.addCommand(shareCommand());
  cmd.addCommand(tokenCommand());
  cmd.addCommand(injectCommand());
  cmd.addCommand(redactCommand());

  return cmd;
}
