import { Command, InvalidArgumentError } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';

type MemberRole = 'admin' | 'member' | 'viewer';

interface MemberRoleOptions {
  org: string;
  email: string;
  role: MemberRole;
}

interface MemberRoleResponse {
  email?: string;
  role?: string;
}

export function memberRoleCommand(): Command {
  return new Command('role')
    .description('Change member role')
    .requiredOption('--org <org>', 'Organization ID')
    .requiredOption('--email <email>', 'Member email address')
    .requiredOption('--role <role>', 'Role: admin|member|viewer', validateRole)
    .action(async function (this: Command) {
      const opts = this.opts<MemberRoleOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        await requireAuth(globals);
        const api = await getApiClient(globals);

        const result = await api.put<MemberRoleResponse>(
          `/admin/orgs/${encodeURIComponent(opts.org)}/members/${encodeURIComponent(opts.email)}`,
          { role: opts.role },
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Updated ${result.email ?? opts.email} role to ${result.role ?? opts.role} in ${opts.org}`);
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          output.error(err.message);
        } else {
          output.error(err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });
}

function validateRole(value: string): MemberRole {
  if (value === 'admin' || value === 'member' || value === 'viewer') {
    return value;
  }
  throw new InvalidArgumentError('role must be one of: admin, member, viewer');
}
