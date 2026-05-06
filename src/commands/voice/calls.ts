import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface ListCallsOptions {
  agent?: string;
  state?: string;
  limit?: string;
  offset?: string;
}

function formatDuration(seconds?: number | null): string {
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
    .option('--state <state>', 'Filter by state (INITIATING, RINGING, ACTIVE, ENDED)')
    .option('--limit <n>', 'Max results (default: 20)')
    .option('--offset <n>', 'Offset for pagination')
    .action(async function (this: Command) {
      const opts = this.opts<ListCallsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.voice.listCalls({
          agentId: opts.agent,
          state: opts.state,
          limit: opts.limit ? Number(opts.limit) : 20,
          offset: opts.offset ? Number(opts.offset) : 0,
        });

        if (globals.json) {
          output.json(response);
          return;
        }

        const calls = response.calls;
        const summary = calls.length === 0
          ? 'No calls found'
          : `${calls.length} of ${response.total} call(s)`;
        output.table(
          ['ID', 'Direction', 'State', 'From', 'To', 'Tier', 'Duration', 'Started'],
          calls.map((c) => [
            c.id.slice(0, 8),
            c.direction,
            c.state,
            c.from,
            c.to,
            c.tier,
            formatDuration(c.durationSeconds),
            formatDate(c.startedAt),
          ]),
          { summary, pagination: { total: response.total } },
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list calls: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
