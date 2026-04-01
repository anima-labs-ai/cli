import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

interface DomainDnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
}

interface DomainDnsResponse {
  records: DomainDnsRecord[];
  [key: string]: unknown;
}

export function domainDnsCommand(): Command {
  return new Command('dns')
    .description('Show domain DNS records')
    .argument('<id>', 'Domain ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<DomainDnsResponse>(`/domains/${id}/dns-records`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['Type', 'Name', 'Value', 'Priority'],
          result.records.map((record) => [
            record.type,
            record.name,
            record.value,
            record.priority === undefined ? '-' : String(record.priority),
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to fetch DNS records: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to fetch DNS records: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
