import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import pc from 'picocolors';

interface SearchOptions {
  agent?: string;
  limit?: string;
  threshold?: string;
  from?: string;
  to?: string;
  crossChannel?: boolean;
}

interface CallSearchResult {
  callId: string;
  speaker: string;
  text: string;
  similarity: number;
  startTime: number;
  agentId: string;
}

interface CallSearchResponse {
  results: CallSearchResult[];
}

interface CrossChannelResult {
  id: string;
  channel: string;
  content: string;
  similarity: number;
  createdAt: string;
  agentId: string;
  callId?: string;
  speaker?: string;
  startTime?: number;
}

interface CrossChannelResponse {
  results: CrossChannelResult[];
}

export function searchCommand(): Command {
  return new Command('search')
    .description('Semantic search across voice call transcripts')
    .argument('<query>', 'Search query')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--limit <n>', 'Max results (default: 10)')
    .option('--threshold <n>', 'Similarity threshold 0-1 (default: 0.7)')
    .option('--from <date>', 'Filter from date (ISO 8601)')
    .option('--to <date>', 'Filter to date (ISO 8601)')
    .option('--cross-channel', 'Search across email, SMS, and voice')
    .action(async function (this: Command, query: string) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const client = await requireAuth(globals);

        if (opts.crossChannel) {
          await handleCrossChannel(client, query, opts, globals, output);
        } else {
          await handleVoiceSearch(client, query, opts, globals, output);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Search failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}

async function handleVoiceSearch(
  client: { post: <T>(path: string, body?: unknown) => Promise<T> },
  query: string,
  opts: SearchOptions,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const body: Record<string, unknown> = { query };
  if (opts.agent) body.agentId = opts.agent;
  if (opts.limit) body.limit = Number(opts.limit);
  if (opts.threshold) body.threshold = Number(opts.threshold);
  if (opts.from) body.dateFrom = opts.from;
  if (opts.to) body.dateTo = opts.to;

  const response = await client.post<CallSearchResponse>('/voice/search', body);

  if (globals.json) {
    output.json(response);
    return;
  }

  const results = response.results ?? [];
  const summary = results.length === 0 ? 'No results found' : `${results.length} result(s)`;
  output.table(
    ['Score', 'Call', 'Speaker', 'Text'],
    results.map((r) => [
      `${(r.similarity * 100).toFixed(1)}%`,
      r.callId.slice(0, 8),
      r.speaker,
      r.text,
    ]),
    { summary },
  );
}

async function handleCrossChannel(
  client: { post: <T>(path: string, body?: unknown) => Promise<T> },
  query: string,
  opts: SearchOptions,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const body: Record<string, unknown> = {
    query,
    channels: ['email', 'sms', 'voice'],
  };
  if (opts.agent) body.agentId = opts.agent;
  if (opts.limit) body.limit = Number(opts.limit);
  if (opts.threshold) body.threshold = Number(opts.threshold);

  const response = await client.post<CrossChannelResponse>(
    '/voice/search/cross-channel',
    body,
  );

  if (globals.json) {
    output.json(response);
    return;
  }

  const results = response.results ?? [];
  const summary = results.length === 0 ? 'No results found' : `${results.length} result(s)`;
  output.table(
    ['Score', 'Channel', 'Preview'],
    results.map((r) => [
      `${(r.similarity * 100).toFixed(1)}%`,
      r.channel,
      r.content.length > 80 ? `${r.content.slice(0, 80)}...` : r.content,
    ]),
    { summary },
  );
}

