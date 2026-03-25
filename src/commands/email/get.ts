import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface GetEmailResponse {
  id: string;
  agentId: string;
  subject?: string;
  body?: string;
  bodyHtml?: string;
  status?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export function getEmailCommand(): Command {
  return new Command('get')
    .description('Get email by ID')
    .argument('<id>', 'Email ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<GetEmailResponse>(`/api/v1/email/${id}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Agent ID', result.agentId],
          ['Subject', result.subject],
          ['Status', result.status],
          ['To', result.to?.join(', ')],
          ['CC', result.cc?.join(', ')],
          ['BCC', result.bcc?.join(', ')],
          ['Created At', result.createdAt],
          ['Updated At', result.updatedAt],
          ['Body', result.body],
          ['HTML Body', result.bodyHtml],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get email: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get email: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
