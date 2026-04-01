import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

interface AddDomainResponse {
  id: string;
  domain: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export function addDomainCommand(): Command {
  return new Command('add')
    .description('Add a sending domain')
    .argument('<domain>', 'Domain name')
    .action(async function (this: Command, domain: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<AddDomainResponse>('/domains', {
          domain: domain.toLowerCase(),
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Domain', result.domain],
          ['Status', result.status],
          ['Created At', result.createdAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to add domain: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to add domain: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
