import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface EventsOptions {
  severity?: Severity;
  limit?: number;
  cursor?: string;
}

interface SecurityEvent {
  id: string;
  type: string;
  severity: string;
  message: string;
  source?: string;
  timestamp?: string;
}

interface EventsResponse {
  data: SecurityEvent[];
  nextCursor?: string;
}

function parseSeverity(value: string): Severity {
  const lower = value.toLowerCase();
  if (lower !== 'low' && lower !== 'medium' && lower !== 'high' && lower !== 'critical') {
    throw new InvalidArgumentError('Severity must be low, medium, high, or critical');
  }
  return lower;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('Limit must be an integer between 1 and 100');
  }
  return parsed;
}

export function securityEventsCommand(): Command {
  return new Command('events')
    .description('List security events')
    .option('--severity <level>', 'Filter by severity (low|medium|high|critical)', parseSeverity)
    .option('--limit <n>', 'Page size (1-100)', parseLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command) {
      const opts = this.opts<EventsOptions>();
      const globals = this.optsWithGlobals<EventsOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const query: Record<string, string> = {};
      if (opts.severity !== undefined) {
        query.severity = opts.severity;
      }
      if (opts.limit !== undefined) {
        query.limit = String(opts.limit);
      }
      if (opts.cursor !== undefined) {
        query.cursor = opts.cursor;
      }

      try {
        const client = await requireAuth(globals);
        const result = await client.get<EventsResponse>('/api/v1/security/events', query);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Type', 'Severity', 'Message', 'Source', 'Timestamp'],
          result.data.map((evt) => [
            evt.id,
            evt.type,
            evt.severity,
            evt.message,
            evt.source ?? '-',
            evt.timestamp ?? '-',
          ]),
        );

        if (result.nextCursor) {
          output.info(`Next cursor: ${result.nextCursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list security events: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list security events: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
