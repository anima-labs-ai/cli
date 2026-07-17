import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { collectValue } from '../../lib/args.js';

type MessageDirection = 'INBOUND' | 'OUTBOUND';
type MessageStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'BOUNCED'
  | 'BLOCKED'
  | 'PENDING_APPROVAL';

interface SearchEmailsOptions {
  semantic?: boolean;
  agent?: string;
  direction?: MessageDirection;
  status?: MessageStatus;
  label: string[];
  includeSpam?: boolean;
  limit?: string;
  cursor?: string;
  threshold?: string;
}

/** Cross-option validation failure — rendered as a CLI error, exit 1. */
class UsageError extends Error {}

/**
 * `anima email search` — the CLI surface for competitive-parity item B11.
 *
 * Two modes, two endpoints:
 *   - default: full-text search via POST /messages/search, scoped to the
 *     EMAIL channel (this lives under `email`; `anima message search`
 *     covers other channels).
 *   - --semantic: embedding-based ranking via POST /messages/search/semantic.
 *     The semantic endpoint has no channel filter, so results may span
 *     channels — each row therefore shows its channel.
 *
 * Mode-specific flags fail loudly when used in the wrong mode instead of
 * being silently ignored.
 */
export function searchEmailsCommand(): Command {
  return new Command('search')
    .description('Search emails by text query (add --semantic for meaning-based ranking)')
    .argument('<query>', 'Search query text')
    .option('--semantic', 'Rank by semantic similarity instead of text match (searches message content across channels)')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--direction <dir>', 'Filter by direction (INBOUND, OUTBOUND) — full-text mode only', validateDirection)
    .option('--status <status>', 'Filter by delivery status — full-text mode only', validateStatus)
    .option('--label <label>', 'Only email carrying this label; repeat to require ALL. System: unread, read, archived, spam — full-text mode only', collectValue, [])
    .option('--include-spam', 'Include email flagged as spam on arrival (excluded by default) — full-text mode only')
    .option('--limit <number>', 'Max results (full-text 1-100, default 20; semantic 1-50, default 10)')
    .option('--cursor <cursor>', 'Pagination cursor — full-text mode only')
    .option('--threshold <number>', 'Minimum similarity score 0-1 (default 0.7) — semantic mode only')
    .action(async function (this: Command, query: string) {
      const opts = this.opts<SearchEmailsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        if (opts.semantic) {
          assertNoFlags('cannot be combined with --semantic (full-text options)', [
            ['--direction', opts.direction],
            ['--status', opts.status],
            ['--cursor', opts.cursor],
            // The semantic endpoint takes only query/agentId/limit/threshold, so
            // labels would be dropped server-side and the caller told its filter
            // applied while every label was ignored — refuse rather than lie.
            ['--label', opts.label.length > 0 ? 'set' : undefined],
            ['--include-spam', opts.includeSpam ? 'true' : undefined],
          ]);
          await runSemanticSearch(query, opts, globals, output);
          return;
        }

        assertNoFlags('only applies to --semantic mode', [['--threshold', opts.threshold]]);
        await runFullTextSearch(query, opts, globals, output);
      } catch (error: unknown) {
        if (error instanceof UsageError) {
          output.fatal(error.message);
          return;
        }
        if (opts.semantic && error instanceof ORPCError && error.status === 503) {
          output.fatal('Semantic search is temporarily unavailable (embedding provider outage). Retry later, or search without --semantic.');
          return;
        }
        handleOrpcError(error, output, 'Failed to search emails');
      }
    });
}

async function runFullTextSearch(
  query: string,
  opts: SearchEmailsOptions,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const limit = parseBoundedInt('--limit', opts.limit, 1, 100) ?? 20;

  const orpc = await requireOrpcAuth(globals);
  const result = await orpc.message.search({
    query,
    filters: {
      // This command is the email surface — always scope full-text
      // search to the EMAIL channel.
      channel: 'EMAIL',
      agentId: opts.agent,
      direction: opts.direction,
      status: opts.status,
      labels: opts.label.length > 0 ? opts.label : undefined,
      includeSpam: opts.includeSpam,
    },
    pagination: {
      cursor: opts.cursor,
      limit,
    },
  });

  if (globals.json) {
    output.json(result);
    return;
  }

  const items = result.items;
  if (items.length === 0) {
    output.info('No emails found');
    return;
  }

  output.table(
    ['ID', 'Direction', 'Status', 'From', 'To', 'Subject', 'Labels', 'Created At'],
    items.map((msg) => [
      msg.id,
      msg.direction,
      msg.status,
      msg.fromAddress,
      msg.toAddress,
      msg.subject ? msg.subject.substring(0, 40) : '-',
      (msg.labels ?? []).join(', ') || '-',
      msg.createdAt,
    ]),
    {
      pagination: {
        has_more: result.pagination.hasMore,
        next_cursor: result.pagination.nextCursor,
      },
    },
  );
}

async function runSemanticSearch(
  query: string,
  opts: SearchEmailsOptions,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const limit = parseBoundedInt('--limit', opts.limit, 1, 50) ?? 10;
  const threshold = parseThreshold(opts.threshold);

  const orpc = await requireOrpcAuth(globals);
  const result = await orpc.message.semanticSearch({
    query,
    agentId: opts.agent,
    limit,
    threshold,
  });

  if (globals.json) {
    output.json(result);
    return;
  }

  const results = result.results;
  if (results.length === 0) {
    output.info('No matches found');
    return;
  }

  output.table(
    ['ID', 'Similarity', 'Channel', 'Agent', 'Content', 'Created At'],
    results.map((match) => [
      match.id,
      match.similarity.toFixed(3),
      match.channel,
      match.agentId,
      match.content.length > 60 ? `${match.content.substring(0, 60)}…` : match.content,
      match.createdAt,
    ]),
  );
}

/** Throw a UsageError when a flag from the other mode is present. */
function assertNoFlags(
  reason: string,
  flags: Array<[name: string, value: string | undefined]>,
): void {
  const offending = flags.filter(([, value]) => value !== undefined).map(([name]) => name);
  if (offending.length === 0) return;
  throw new UsageError(`${offending.join(', ')} ${reason}.`);
}

function parseBoundedInt(
  flag: string,
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(`${flag} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseThreshold(value: string | undefined): number {
  if (value === undefined) return 0.7;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    throw new UsageError('--threshold must be a number between 0 and 1');
  }
  return parsed;
}

function validateDirection(value: string): MessageDirection {
  const upper = value.toUpperCase();
  if (upper === 'INBOUND' || upper === 'OUTBOUND') {
    return upper;
  }
  throw new InvalidArgumentError('direction must be one of INBOUND, OUTBOUND');
}

function validateStatus(value: string): MessageStatus {
  const upper = value.toUpperCase();
  if (
    upper === 'QUEUED' ||
    upper === 'SENT' ||
    upper === 'DELIVERED' ||
    upper === 'FAILED' ||
    upper === 'BOUNCED' ||
    upper === 'BLOCKED' ||
    upper === 'PENDING_APPROVAL'
  ) {
    return upper;
  }
  throw new InvalidArgumentError(
    'status must be one of QUEUED, SENT, DELIVERED, FAILED, BOUNCED, BLOCKED, PENDING_APPROVAL',
  );
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this resource.');
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
