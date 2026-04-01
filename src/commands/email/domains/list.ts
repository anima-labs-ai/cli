import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

interface DomainListItem {
  id: string;
  domain: string;
  status?: string;
  verified?: boolean;
  createdAt?: string;
}

interface ListDomainsResponse {
  data: DomainListItem[];
}

export function listDomainsCommand(): Command {
  return new Command('list')
    .description('List sending domains')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<ListDomainsResponse>('/domains');

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Domain', 'Status', 'Verified', 'Created At'],
          result.data.map((domain) => [
            domain.id,
            domain.domain,
            domain.status ?? '-',
            domain.verified === undefined ? '-' : String(domain.verified),
            domain.createdAt ?? '-',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list domains: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list domains: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
