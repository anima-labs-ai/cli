import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface TasksOptions {
  agent: string;
  status?: string;
  cursor?: string;
  limit?: string;
}

interface A2ATask {
  id: string;
  type: string;
  status: string;
  fromDid?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ListTasksResponse {
  items: A2ATask[];
  pagination?: {
    nextCursor?: string | null;
  };
}

export function listTasksCommand(): Command {
  return new Command('tasks')
    .description('List A2A tasks for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--status <status>', 'Filter by status (SUBMITTED, WORKING, COMPLETED, CANCELED, FAILED)')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)')
    .action(async function (this: Command) {
      const opts = this.opts<TasksOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const params: Record<string, string> = {};
        if (opts.status) {
          params.status = opts.status;
        }
        if (opts.cursor) {
          params.cursor = opts.cursor;
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
        const result = await client.get<ListTasksResponse>(
          `/api/v1/agents/${opts.agent}/a2a/tasks`,
          params,
        );

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Type', 'Status', 'From DID', 'Created At'],
          result.items.map((task) => [
            task.id,
            task.type,
            task.status,
            task.fromDid ?? '-',
            task.createdAt ?? '-',
          ]),
        );

        if (result.pagination?.nextCursor) {
          output.info(`Next cursor: ${result.pagination.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list tasks: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list tasks: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
