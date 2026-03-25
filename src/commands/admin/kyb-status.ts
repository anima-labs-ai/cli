import { Command } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';

interface KybStatusOptions {
  org: string;
}

interface KybResponse {
  status?: string;
  documentsNeeded?: string[];
}

export function kybStatusCommand(): Command {
  return new Command('status')
    .description('Show KYB verification status')
    .requiredOption('--org <org>', 'Organization ID')
    .action(async function (this: Command) {
      const opts = this.opts<KybStatusOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        await requireAuth(globals);
        const api = await getApiClient(globals);
        const result = await api.get<KybResponse>(`/admin/orgs/${encodeURIComponent(opts.org)}/kyb`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Org', opts.org],
          ['Status', result.status],
          ['Documents Needed', result.documentsNeeded?.join(', ') || 'None'],
        ]);
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
