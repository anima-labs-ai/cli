import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

interface DomainDetailsResponse {
  id: string;
  domain: string;
  status?: string;
  verified?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export function getDomainCommand(): Command {
  return new Command('get')
    .description('Get domain details')
    .argument('<id>', 'Domain ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<DomainDetailsResponse>(`/api/v1/domains/${id}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Domain', result.domain],
          ['Status', result.status],
          ['Verified', result.verified === undefined ? undefined : String(result.verified)],
          ['Created At', result.createdAt],
          ['Updated At', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get domain: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get domain: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
