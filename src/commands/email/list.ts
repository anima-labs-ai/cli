import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ListEmailsOptions {
  cursor?: string;
  limit?: string;
  agent?: string;
}

interface EmailListItem {
  id: string;
  agentId: string;
  subject?: string;
  status?: string;
  createdAt?: string;
  to?: string[];
}

interface ListEmailsResponse {
  data: EmailListItem[];
  nextCursor?: string | null;
}

export function listEmailsCommand(): Command {
  return new Command('list')
    .description('List emails')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)')
    .option('--agent <id>', 'Filter by agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<ListEmailsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const params: Record<string, string> = {};
        if (opts.cursor) {
          params.cursor = opts.cursor;
        }
        if (opts.agent) {
          params.agentId = opts.agent;
        }
        if (opts.limit) {
          const parsedLimit = Number.parseInt(opts.limit, 10);
          if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
            output.error('Limit must be an integer between 1 and 100.');
            process.exit(1);
          }
          params.limit = String(parsedLimit);
        }

        const client = await requireAuth(globals);
        const result = await client.get<ListEmailsResponse>('/email', params);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Agent', 'Subject', 'Status', 'To', 'Created At'],
          result.data.map((email) => [
            email.id,
            email.agentId,
            email.subject ?? '-',
            email.status ?? '-',
            email.to?.join(', ') ?? '-',
            email.createdAt ?? '-',
          ]),
        );

        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list emails: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list emails: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
