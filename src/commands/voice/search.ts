import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth, type AnimaClient } from '../../lib/orpc.js';

interface SearchOptions {
  agent?: string;
  limit?: string;
  threshold?: string;
  from?: string;
  to?: string;
  crossChannel?: boolean;
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
        const orpc = await requireOrpcAuth(globals);

        if (opts.crossChannel) {
          await handleCrossChannel(orpc, query, opts, globals, output);
        } else {
          await handleVoiceSearch(orpc, query, opts, globals, output);
        }
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Search failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}

async function handleVoiceSearch(
  orpc: AnimaClient,
  query: string,
  opts: SearchOptions,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const response = await orpc.voice.search({
    query,
    agentId: opts.agent,
    limit: opts.limit ? Number(opts.limit) : 10,
    threshold: opts.threshold ? Number(opts.threshold) : 0.3,
    dateFrom: opts.from,
    dateTo: opts.to,
  });

  if (globals.json) {
    output.json(response);
    return;
  }

  const results = response.results;
  const summary = results.length === 0 ? 'No results found' : `${results.length} result(s)`;
  output.table(
    ['Score', 'Call', 'Speaker', 'Text'],
    results.map((r) => [
      `${(r.similarity * 100).toFixed(1)}%`,
      r.callId.slice(0, 8),
      r.speaker,
      r.matchedText,
    ]),
    { summary },
  );
}

async function handleCrossChannel(
  orpc: AnimaClient,
  query: string,
  opts: SearchOptions,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const response = await orpc.voice.crossChannelSearch({
    query,
    channels: ['email', 'sms', 'voice'],
    agentId: opts.agent,
    limit: opts.limit ? Number(opts.limit) : 10,
    threshold: opts.threshold ? Number(opts.threshold) : 0.3,
  });

  if (globals.json) {
    output.json(response);
    return;
  }

  const results = response.results;
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
