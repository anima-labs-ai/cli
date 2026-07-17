import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'canceled';

interface TasksOptions {
  agent: string;
  status?: string;
  cursor?: string;
  limit?: string;
}

export function listTasksCommand(): Command {
  return new Command('tasks')
    .description('List A2A tasks for an agent')
    .requiredOption('--agent <id>', 'Agent ID', requireNonEmptyArg('Agent ID'))
    .option('--status <status>', 'Filter by status (submitted, working, input_required, completed, failed, canceled)')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)')
    .action(async function (this: Command) {
      const opts = this.opts<TasksOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        let limit: number | undefined;
        if (opts.limit) {
          const parsedLimit = Number.parseInt(opts.limit, 10);
          if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
            output.fatal('Limit must be an integer between 1 and 100.');
          }
          limit = parsedLimit;
        }

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.a2a.listTasks({
          agentId: opts.agent,
          status: opts.status as A2ATaskStatus | undefined,
          cursor: opts.cursor,
          limit: limit ?? 20,
        });

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

        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list tasks: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list tasks: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
