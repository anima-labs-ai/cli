import { Command, InvalidArgumentError } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { Output } from '../../lib/output.js';

type MemberRole = 'admin' | 'member' | 'viewer';

interface MemberRoleOptions {
  org: string;
  email: string;
  role: MemberRole;
}


export function memberRoleCommand(): Command {
  return new Command('role')
    .description('Change member role')
    // Optional, because this command always refuses: there is no endpoint to
    // call. Mandatory flags would only make the user satisfy three of them to
    // be told the command does not exist.
    .option('--org <org>', 'Organization ID', requireNonEmptyArg('Organization ID'))
    .option('--email <email>', 'Member email address')
    .option('--role <role>', 'Role: admin|member|viewer', validateRole)
    .action(async function (this: Command) {
      const output = Output.fromGlobals(this.optsWithGlobals<GlobalOptions>());

      // Member management has no API to call. `/v1/admin/orgs/{org}/members`
      // does not exist — there is no /v1/admin/* namespace — and the contract
      // exposes only `GET /orgs/{id}/members`, no writes. Membership lives in
      // Clerk, so invites and role changes happen in the console; there is
      // nothing for the CLI to POST to.
      //
      // Failing here rather than issuing the request keeps the reason
      // ("this is console-only") from arriving as "Route not found", which
      // reads as a broken CLI.
      output.error('Changing member roles is not available from the CLI.');
      output.info(
        'Organization membership is managed in Clerk. Change roles at https://console.useanima.sh/settings/members.',
      );
      process.exit(1);
    });
}

function validateRole(value: string): MemberRole {
  if (value === 'admin' || value === 'member' || value === 'viewer') {
    return value;
  }
  throw new InvalidArgumentError('role must be one of: admin, member, viewer');
}
