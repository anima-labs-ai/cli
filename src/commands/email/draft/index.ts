import { Command } from 'commander';
import { createDraftCommand } from './create.js';
import { getDraftCommand } from './get.js';
import { listDraftsCommand } from './list.js';
import { sendDraftCommand } from './send.js';
import { deleteDraftCommand } from './delete.js';

/**
 * `anima email draft …` — competitive-parity item C5.
 *
 * Drafts are composed-but-not-sent emails owned by an agent. They may be
 * incomplete (no recipients, no subject). `send` converts a draft into a
 * real Message atomically (email.send semantics — threading, scanning and
 * limits all apply) and deletes the draft row.
 */
export function draftCommands(): Command {
  const cmd = new Command('draft')
    .description('Manage email drafts (compose now, send later)');

  cmd.addCommand(createDraftCommand());
  cmd.addCommand(getDraftCommand());
  cmd.addCommand(listDraftsCommand());
  cmd.addCommand(sendDraftCommand());
  cmd.addCommand(deleteDraftCommand());

  return cmd;
}
