import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CredentialsOptions {
  agent: string;
}

interface VerifiableCredential {
  id: string;
  type: string;
  issuer: string;
  subject: string;
  issuanceDate: string;
  expirationDate: string | null;
}

interface CredentialsResponse {
  items: VerifiableCredential[];
}

export function listCredentialsCommand(): Command {
  return new Command('credentials')
    .description('List verifiable credentials for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<CredentialsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const response = await client.get<CredentialsResponse>(`/agents/${opts.agent}/credentials`);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          output.info('No credentials found');
          return;
        }

        output.table(
          ['ID', 'Type', 'Issuer', 'Subject', 'Issued', 'Expires'],
          response.items.map((item) => [
            item.id,
            item.type,
            item.issuer,
            item.subject,
            item.issuanceDate,
            item.expirationDate ?? 'Never',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list credentials: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
