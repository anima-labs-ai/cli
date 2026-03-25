import { Command } from 'commander';
import { orgListCommand } from './org-list.js';
import { memberInviteCommand } from './member-invite.js';
import { memberRoleCommand } from './member-role.js';
import { keyRotateCommand } from './key-rotate.js';
import { keyRevokeCommand } from './key-revoke.js';
import { kybStatusCommand } from './kyb-status.js';
import { usageCommand } from './usage.js';

export function adminCommands(): Command {
  const cmd = new Command('admin').description('Organization and team administration');

  const org = new Command('org').description('Organization management');
  org.addCommand(orgListCommand());

  const member = new Command('member').description('Team member management');
  member.addCommand(memberInviteCommand());
  member.addCommand(memberRoleCommand());

  const key = new Command('key').description('Organization API key management');
  key.addCommand(keyRotateCommand());
  key.addCommand(keyRevokeCommand());

  const kyb = new Command('kyb').description('Know-Your-Business verification');
  kyb.addCommand(kybStatusCommand());

  cmd.addCommand(org);
  cmd.addCommand(member);
  cmd.addCommand(key);
  cmd.addCommand(kyb);
  cmd.addCommand(usageCommand());

  return cmd;
}
