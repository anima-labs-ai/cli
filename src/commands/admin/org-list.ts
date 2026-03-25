import { Command } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';

interface AdminOrg {
  id?: string;
  name?: string;
  plan?: string;
  memberCount?: number;
  createdAt?: string;
}

interface OrgListResponse {
  orgs?: AdminOrg[];
  data?: AdminOrg[];
}

export function orgListCommand(): Command {
  return new Command('list').description('List organizations').action(async function (this: Command) {
    const globals = this.optsWithGlobals<GlobalOptions>();
    const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

    try {
      await requireAuth(globals);
      const api = await getApiClient(globals);
      const result = await api.get<OrgListResponse | AdminOrg[]>('/admin/orgs');

      if (globals.json) {
        output.json(result);
        return;
      }

      const orgs = Array.isArray(result) ? result : (result.orgs ?? result.data ?? []);
      output.table(
        ['Name', 'Plan', 'Members', 'Created'],
        orgs.map((org) => [
          org.name ?? org.id ?? '-',
          org.plan ?? '-',
          org.memberCount === undefined ? '-' : String(org.memberCount),
          org.createdAt ?? '-',
        ]),
      );
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
