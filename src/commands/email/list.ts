import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../lib/orpc.js';
import { collectValue, validateLimit } from '../../lib/args.js';

interface ListEmailsOptions {
  cursor?: string;
  limit?: string;
  agent?: string;
  label: string[];
  includeSpam?: boolean;
}

export function listEmailsCommand(): Command {
  return new Command('list')
    .description('List emails')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .option('--agent <id>', 'Filter by agent ID')
    .option('--label <label>', 'Only email carrying this label; repeat to require ALL (e.g. --label unread --label urgent). System: unread, read, archived, spam', collectValue, [])
    .option('--include-spam', 'Include email flagged as spam on arrival (excluded by default)')
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
          labels: opts.label.length > 0 ? opts.label : undefined,
          includeSpam: opts.includeSpam,
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
          ['ID', 'Agent', 'Subject', 'Status', 'To', 'Labels', 'Created At'],
          items.map((email) => [
            email.id,
            email.agentId,
            email.subject ?? '-',
            email.status,
            email.toAddress,
            (email.labels ?? []).join(', ') || '-',
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
