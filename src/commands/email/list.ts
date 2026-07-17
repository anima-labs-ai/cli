import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { validateLimit } from '../../lib/args.js';

interface ListEmailsOptions {
  cursor?: string;
  limit?: string;
  agent?: string;
}

export function listEmailsCommand(): Command {
  return new Command('list')
    .description('List emails')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--agent <id>', 'Filter by agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<ListEmailsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.email.list({
          cursor: opts.cursor,
          limit: opts.limit ? Number(opts.limit) : undefined,
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        const items = result.items ?? [];
        if (items.length === 0) {
          output.info('No emails found');
          return;
        }

        output.table(
          ['ID', 'Agent', 'Subject', 'Status', 'To', 'Created At'],
          items.map((email) => [
            email.id,
            email.agentId,
            email.subject ?? '-',
            email.status,
            email.toAddress,
            email.createdAt,
          ]),
          {
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list emails');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else {
      output.error(`${context}: ${error.message}`);
    }
  } else if (error instanceof Error) {
    output.error(`${context}: ${error.message}`);
  } else {
    output.error(context);
  }
  process.exit(1);
}
