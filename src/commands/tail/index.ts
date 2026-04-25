/**
 * `am tail` — live event stream across all agent activity.
 *
 * Why it exists:
 *   During development you want to see what your agent is doing without
 *   bouncing between the dashboard, the email log, the SMS log, and the
 *   vault audit log. `am tail` connects to a server-sent-events endpoint
 *   and prints a unified line per event, just like `heroku logs --tail`
 *   or `kubectl logs -f`.
 *
 *   Two filtering flags:
 *     --filter <channel>  — restrict to one channel: email|sms|voice|vault
 *     --agent <id>        — restrict to a single agent identity
 *
 *   --filter and --agent compose: `am tail --filter email --agent xyz` only
 *   shows email events for that agent.
 *
 * Output format:
 *   [HH:MM:SS] channel | agent | event-type   detail-line
 *
 * Backpressure / disconnect:
 *   The SSE connection auto-reconnects with exponential backoff up to 30s
 *   between attempts. Ctrl-C exits cleanly. If the API URL is unreachable
 *   for >5 attempts, we surface the underlying error and exit 1 — better
 *   than spinning forever silently.
 *
 * Server-side dependency:
 *   Expects GET {apiUrl}/v1/events/stream to return text/event-stream with
 *   one JSON object per `data:` line, fields: `ts`, `channel`, `agentId`,
 *   `event`, `detail`. If the endpoint isn't deployed yet, `am tail` will
 *   surface a 404 from the first request and exit. Tracked as a follow-up.
 */
import { Command } from 'commander';

import { ApiError } from '../../lib/api-client.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { getAuthConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';

interface StreamEvent {
  ts: string;
  channel: 'email' | 'sms' | 'voice' | 'vault' | string;
  agentId: string;
  event: string;
  detail?: string;
  correlationId?: string;
}

interface TailOptions {
  filter?: string;
  agent?: string;
  raw?: boolean;
}

const VALID_CHANNELS = new Set(['email', 'sms', 'voice', 'vault']);
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function formatLine(event: StreamEvent): string {
  const ts = new Date(event.ts).toLocaleTimeString();
  const ch = event.channel.padEnd(6);
  const agent = (event.agentId ?? '-').slice(0, 12).padEnd(12);
  const evType = event.event.padEnd(20);
  const detail = event.detail ?? '';
  return `[${ts}] ${ch} | ${agent} | ${evType} ${detail}`;
}

function buildStreamUrl(apiUrl: string, options: TailOptions): string {
  const url = new URL('/v1/events/stream', apiUrl);
  if (options.filter) url.searchParams.set('channel', options.filter);
  if (options.agent) url.searchParams.set('agentId', options.agent);
  return url.toString();
}

async function streamOnce(
  apiUrl: string,
  apiKey: string,
  options: TailOptions,
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  const response = await fetch(buildStreamUrl(apiUrl, options), {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'text/event-stream',
    },
    signal,
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `HTTP_${response.status}`,
      `events/stream returned ${response.status}`,
    );
  }
  if (!response.body) {
    throw new Error('events/stream returned empty body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error('stream closed by server');
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        const event = JSON.parse(json) as StreamEvent;
        if (options.raw) {
          console.log(JSON.stringify(event));
        } else {
          console.log(formatLine(event));
        }
      } catch (parseError) {
        output.warn(
          `[am tail] dropped malformed event: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }
    }
  }
}

export function tailCommand(): Command {
  return new Command('tail')
    .description('Stream agent activity (email, SMS, voice, vault) in real time')
    .option('--filter <channel>', 'Restrict to one channel: email|sms|voice|vault')
    .option('--agent <id>', 'Restrict to a single agent identity ID')
    .option('--raw', 'Emit raw JSON per event instead of formatted line')
    .action(async function (this: Command) {
      const opts = this.opts<TailOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if (opts.filter && !VALID_CHANNELS.has(opts.filter)) {
        output.error(
          `--filter must be one of email|sms|voice|vault, got "${opts.filter}"`,
        );
        process.exit(2);
      }

      const auth = await getAuthConfig();
      const apiKey = auth.apiKey ?? auth.token;
      if (!apiKey) {
        output.error('Not authenticated. Run `anima auth login` or set an API key first.');
        process.exit(1);
      }
      const apiUrl = auth.apiUrl ?? 'https://api.useanima.sh';

      const controller = new AbortController();
      const onSigint = () => {
        output.info('\n[am tail] disconnecting…');
        controller.abort();
        process.exit(0);
      };
      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigint);

      output.info(
        `[am tail] streaming ${apiUrl} (filter=${opts.filter ?? 'all'} agent=${opts.agent ?? 'all'})`,
      );

      let attempts = 0;
      let backoff = INITIAL_BACKOFF_MS;
      while (!controller.signal.aborted) {
        try {
          await streamOnce(apiUrl, apiKey, opts, controller.signal, output);
          // streamOnce only returns by abort or throw; reaching here is unexpected.
          break;
        } catch (error) {
          if (controller.signal.aborted) break;
          attempts += 1;
          const message = error instanceof Error ? error.message : String(error);
          if (attempts > MAX_RECONNECT_ATTEMPTS) {
            output.error(`[am tail] giving up after ${attempts} attempts: ${message}`);
            process.exit(1);
          }
          output.warn(
            `[am tail] disconnected (${message}); retrying in ${backoff}ms (attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS})`,
          );
          await new Promise((res) => setTimeout(res, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        }
      }
    });
}
