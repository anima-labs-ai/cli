import { Command, InvalidArgumentError } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { getConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';

type MemberRole = 'admin' | 'member' | 'viewer';

interface MemberInviteOptions {
  org?: string;
  email: string;
  role: MemberRole;
}

interface MemberInviteResponse {
  email?: string;
  role?: string;
  invited?: boolean;
}

export function memberInviteCommand(): Command {
  return new Command('invite')
    .description('Invite a team member')
    .option('--org <org>', 'Organization ID (overrides configured default org)')
    .requiredOption('--email <email>', 'Member email address')
    .option('--role <role>', 'Role: admin|member|viewer', validateRole, 'member')
    .action(async function (this: Command) {
      const opts = this.opts<MemberInviteOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        await requireAuth(globals);
        const api = await getApiClient(globals);
        const org = await resolveOrg(opts.org);

        const result = await api.post<MemberInviteResponse>(`/admin/orgs/${encodeURIComponent(org)}/members`, {
          email: opts.email,
          role: opts.role,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Invited ${result.email ?? opts.email} to ${org} as ${result.role ?? opts.role}`);
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

async function resolveOrg(flagOrg?: string): Promise<string> {
  if (flagOrg) {
    return flagOrg;
  }

  const config = await getConfig();
  if (config.defaultOrg) {
    return config.defaultOrg;
  }

  throw new Error("No org specified. Use --org <org> or set default with 'am config set defaultOrg <org>'");
}
