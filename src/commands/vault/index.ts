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
// NOTE: `am vault oauth` (OAuth Apps + Connect Links) was removed from the CLI
// on 2026-04-25 — the credential-broker model handles third-party auth through
// vault credentials + vtk_ ephemeral tokens instead of a separate OAuth
// catalogue. The HTTP endpoints for OAuth linking remain on the API for the
// console, but the CLI no longer exposes them as first-class commands.
import { execCommand } from './exec.js';
import { auditCommand } from './audit.js';
import { reloadCommand } from './reload.js';
import { unlockCommand } from './unlock.js';
import { proxyCommand } from './proxy.js';
import { agentCommand, typeCommand } from './agent.js';

export function vaultCommands(): Command {
  // enablePositionalOptions is required because `am vault exec` uses
  // passThroughOptions so that flags after `--` get forwarded to the child
  // process instead of being eaten by Commander.
  const cmd = new Command('vault')
    .description('Manage the agent credential vault (store, share, inject, exec)')
    .enablePositionalOptions();

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

  // New in v0.5 — zero-knowledge execution primitives
  cmd.addCommand(execCommand());
  cmd.addCommand(auditCommand());
  cmd.addCommand(reloadCommand());
  cmd.addCommand(unlockCommand());
  cmd.addCommand(proxyCommand());
  cmd.addCommand(agentCommand());
  cmd.addCommand(typeCommand());

  return cmd;
}
