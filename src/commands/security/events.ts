import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type EventType =
  | 'PII_DETECTED'
  | 'INJECTION_DETECTED'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'APPROVED'
  | 'REJECTED';

interface EventsOptions {
  org?: string;
  agent?: string;
  type?: EventType;
  severity?: Severity;
  limit?: number;
  cursor?: string;
}

function parseSeverity(value: string): Severity {
  const upper = value.toUpperCase();
  if (upper !== 'LOW' && upper !== 'MEDIUM' && upper !== 'HIGH' && upper !== 'CRITICAL') {
    throw new InvalidArgumentError('Severity must be low, medium, high, or critical');
  }
  return upper;
}

function parseType(value: string): EventType {
  const upper = value.toUpperCase();
  if (
    upper !== 'PII_DETECTED' &&
    upper !== 'INJECTION_DETECTED' &&
    upper !== 'RATE_LIMITED' &&
    upper !== 'BLOCKED' &&
    upper !== 'APPROVED' &&
    upper !== 'REJECTED'
  ) {
    throw new InvalidArgumentError(
      'Type must be one of PII_DETECTED, INJECTION_DETECTED, RATE_LIMITED, BLOCKED, APPROVED, REJECTED',
    );
  }
  return upper;
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
    .option('--org <orgId>', 'Organization ID (derived from auth if omitted)')
    .option('--agent <agentId>', 'Filter events by agent')
    .option(
      '--type <type>',
      'Filter by type (PII_DETECTED|INJECTION_DETECTED|RATE_LIMITED|BLOCKED|APPROVED|REJECTED)',
      parseType,
    )
    .option('--severity <level>', 'Filter by severity (low|medium|high|critical)', parseSeverity)
    .option('--limit <n>', 'Page size (1-100)', parseLimit)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async function (this: Command) {
      const opts = this.opts<EventsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        // The contract requires orgId — derive it from auth when --org is omitted.
        const orgId = opts.org ?? (await orpc.org.me({})).id;
        const result = await orpc.security.listEvents({
          orgId,
          agentId: opts.agent,
          type: opts.type,
          severity: opts.severity,
          limit: opts.limit,
          cursor: opts.cursor,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Type', 'Severity', 'Agent', 'Message', 'Resolved', 'Created At'],
          result.items.map((evt) => [
            evt.id,
            evt.type,
            evt.severity,
            evt.agentId ?? '-',
            evt.messageId ?? '-',
            evt.resolved ? 'yes' : 'no',
            evt.createdAt instanceof Date ? evt.createdAt.toISOString() : String(evt.createdAt),
          ]),
          {
            summary: `Returned ${result.items.length} events.`,
            pagination: {
              has_more: result.pagination.hasMore,
              next_cursor: result.pagination.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to list security events');
      }
    });
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this organization.');
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
