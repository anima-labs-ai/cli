import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ListCallsOptions {
  agent?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

interface CallListItem {
  id: string;
  agentId: string;
  direction: string;
  status: string;
  from: string;
  to: string;
  tier: string;
  durationSeconds?: number;
  startedAt: string;
  endedAt?: string;
}

interface ListCallsResponse {
  items: CallListItem[];
  total: number;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function listCallsCommand(): Command {
  return new Command('calls')
    .description('List voice calls')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--status <status>', 'Filter by status (active, completed, failed)')
    .option('--limit <n>', 'Max results (default: 20)')
    .option('--offset <n>', 'Offset for pagination')
    .action(async function (this: Command) {
      const opts = this.opts<ListCallsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);

        const params: Record<string, string> = {};
        if (opts.agent) params.agentId = opts.agent;
        if (opts.status) params.status = opts.status;
        if (opts.limit) params.limit = opts.limit;
        if (opts.offset) params.offset = opts.offset;

        const response = await client.get<ListCallsResponse>('/voice/calls', params);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (!response.items || response.items.length === 0) {
          output.info('No calls found');
          return;
        }

        output.table(
          ['ID', 'Direction', 'Status', 'From', 'To', 'Tier', 'Duration', 'Started'],
          response.items.map((c) => [
            c.id.slice(0, 8),
            c.direction,
            c.status,
            c.from,
            c.to,
            c.tier,
            formatDuration(c.durationSeconds),
            formatDate(c.startedAt),
          ]),
        );

        output.info(`\n${response.items.length} of ${response.total} call(s)`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list calls: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
