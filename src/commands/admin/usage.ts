import { Command } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';

interface UsageOptions {
  org: string;
}

interface UsageResponse {
  identities?: number;
  emails?: number;
  cards?: number;
  storage?: string;
}

export function usageCommand(): Command {
  return new Command('usage')
    .description('Show usage summary')
    .requiredOption('--org <org>', 'Organization ID')
    .action(async function (this: Command) {
      const opts = this.opts<UsageOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        await requireAuth(globals);
        const api = await getApiClient(globals);
        const result = await api.get<UsageResponse>(`/admin/orgs/${encodeURIComponent(opts.org)}/usage`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Org', opts.org],
          ['Identities', result.identities === undefined ? '-' : String(result.identities)],
          ['Emails', result.emails === undefined ? '-' : String(result.emails)],
          ['Cards', result.cards === undefined ? '-' : String(result.cards)],
          ['Storage', result.storage],
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
