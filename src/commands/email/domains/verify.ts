import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

interface VerifyDomainResponse {
  id?: string;
  domain?: string;
  verified?: boolean;
  status?: string;
  [key: string]: unknown;
}

export function verifyDomainCommand(): Command {
  return new Command('verify')
    .description('Verify a sending domain')
    .argument('<id>', 'Domain ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<VerifyDomainResponse>(`/api/v1/domains/${id}/verify`, {
          domainId: id,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id ?? id],
          ['Domain', result.domain],
          ['Status', result.status],
          ['Verified', result.verified === undefined ? undefined : String(result.verified)],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to verify domain: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to verify domain: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
