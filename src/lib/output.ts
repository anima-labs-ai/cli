import pc from 'picocolors';
import Table from 'cli-table3';
import ora, { type Ora } from 'ora';

// Output formats — agent is default (machine-optimized, low-token).
// Mirrors Ramp's --agent / --human pattern (https://agents.ramp.com).
export type OutputFormat = 'agent' | 'human' | 'json' | 'yaml' | 'jsonl' | 'md';

const VALID_FORMATS: ReadonlySet<OutputFormat> = new Set([
  'agent',
  'human',
  'json',
  'yaml',
  'jsonl',
  'md',
]);

export class InvalidFormatError extends Error {
  constructor(public readonly received: string) {
    super(
      `Invalid --format "${received}". Allowed: ${[...VALID_FORMATS].join(', ')}.`,
    );
    this.name = 'InvalidFormatError';
  }
}

export interface OutputOptions {
  // Legacy — kept for backwards compatibility. If `format` is unset and `json`
  // is true, format becomes 'json' (pretty JSON for debug output).
  json?: boolean;
  human?: boolean;
  format?: OutputFormat;
  debug: boolean;
}

function resolveFormat(options: OutputOptions): OutputFormat {
  // Explicit flags always win.
  if (options.format !== undefined) {
    if (!VALID_FORMATS.has(options.format)) {
      throw new InvalidFormatError(String(options.format));
    }
    return options.format;
  }
  if (options.human) return 'human';
  if (options.json) return 'json';

  // TTY-aware default: interactive shells get human output (colors,
  // tables, prose); pipes/redirects/non-TTY environments get the agent
  // format (compact one-line JSON). Same auto-detection principle as
  // `am auth login` — pick the right default for the context.
  //
  // Tests force 'agent' via NODE_ENV=test or ANIMA_FORCE_AGENT_FORMAT=1
  // so golden snapshots stay deterministic regardless of where they run.
  if (process.env.NODE_ENV === 'test' || process.env.ANIMA_FORCE_AGENT_FORMAT === '1') {
    return 'agent';
  }
  if (process.stdout.isTTY) return 'human';
  return 'agent';
}

// Render a structured payload as a single-line JSON string. ~30-40% smaller
// than pretty-print JSON for typical payloads (measured against synthetic
// list payloads, May 2026).
function compactJson(data: unknown): string {
  return JSON.stringify(data);
}

function prettyJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function toJsonl(data: unknown): string {
  if (Array.isArray(data)) return data.map((item) => JSON.stringify(item)).join('\n');
  return JSON.stringify(data);
}

function toYaml(data: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'string') {
    return /[:#\n"']/.test(data) ? JSON.stringify(data) : data;
  }
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    return data.map((item) => `${pad}- ${toYaml(item, indent + 1).trimStart()}`).join('\n');
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const rendered = toYaml(value, indent + 1);
        const isComplex = typeof value === 'object' && value !== null;
        return isComplex ? `${pad}${key}:\n${rendered}` : `${pad}${key}: ${rendered}`;
      })
      .join('\n');
  }
  return String(data);
}

function toMarkdown(data: unknown): string {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const headers = Object.keys(data[0] as object);
    const headerRow = `| ${headers.join(' | ')} |`;
    const sepRow = `| ${headers.map(() => '---').join(' | ')} |`;
    const rows = (data as Record<string, unknown>[]).map(
      (item) => `| ${headers.map((h) => String(item[h] ?? '')).join(' | ')} |`,
    );
    return [headerRow, sepRow, ...rows].join('\n');
  }
  return '```json\n' + prettyJson(data) + '\n```';
}

export class Output {
  /**
   * Resolved output format. Public so callers can branch on it (e.g. the
   * `whoami` command renders a table for `human` and a structured payload
   * for `agent`/`json`/etc.). Same value as what `payload`/`details`
   * internally use to dispatch.
   */
  readonly format: OutputFormat;
  private readonly debugMode: boolean;

  constructor(options: OutputOptions) {
    this.format = resolveFormat(options);
    this.debugMode = options.debug;
  }

  // Construct from CLI globals — propagates --human, --json, --format, --debug
  // without each command having to remember the full mapping.
  static fromGlobals(globals: {
    json?: boolean;
    human?: boolean;
    format?: OutputFormat;
    debug?: boolean;
  }): Output {
    return new Output({
      json: globals.json ?? false,
      human: globals.human ?? false,
      format: globals.format,
      debug: globals.debug ?? false,
    });
  }

  // Format-aware: machines get compact JSON, humans get a pretty box table.
  // `meta` is optional pagination/summary that accompanies the rows; in agent
  // formats it surfaces inside the structured payload, in human format it
  // renders as info lines under the table.
  table(
    headers: string[],
    rows: string[][],
    meta?: {
      pagination?: {
        has_more?: boolean;
        next_cursor?: string | null;
        total?: number;
      };
      summary?: string;
    },
  ): void {
    const objects = rows.map((row) =>
      headers.reduce<Record<string, string>>((obj, header, i) => {
        obj[header.toLowerCase().replace(/\s+/g, '_')] = row[i] ?? '';
        return obj;
      }, {}),
    );

    if (this.format === 'agent' || this.format === 'json' || this.format === 'yaml' || this.format === 'md') {
      const payload = meta ? { items: objects, ...meta } : objects;
      switch (this.format) {
        case 'agent':
          console.log(compactJson(payload));
          return;
        case 'json':
          console.log(prettyJson(payload));
          return;
        case 'yaml':
          console.log(toYaml(payload));
          return;
        case 'md':
          console.log(toMarkdown(meta ? objects : (payload as unknown[])));
          return;
      }
    }
    if (this.format === 'jsonl') {
      console.log(toJsonl(objects));
      return;
    }

    const table = new Table({
      head: headers.map((h) => pc.bold(pc.cyan(h))),
      style: { head: [], border: [] },
    });
    for (const row of rows) table.push(row);
    console.log(table.toString());

    if (meta?.summary) console.log(`${pc.blue('i')} ${meta.summary}`);
    if (meta?.pagination) {
      const p = meta.pagination;
      if (p.total !== undefined) console.log(`${pc.blue('i')} Total: ${p.total}`);
      if (p.has_more !== undefined) console.log(`${pc.blue('i')} Has more: ${p.has_more ? 'yes' : 'no'}`);
      if (p.next_cursor) console.log(`${pc.blue('i')} Next cursor: ${p.next_cursor}`);
    }
  }

  // Render an arbitrary structured payload. The shape of `data` is preserved
  // across formats; only the rendering changes.
  payload(data: unknown): void {
    switch (this.format) {
      case 'agent':
        console.log(compactJson(data));
        return;
      case 'json':
        console.log(prettyJson(data));
        return;
      case 'jsonl':
        console.log(toJsonl(data));
        return;
      case 'yaml':
        console.log(toYaml(data));
        return;
      case 'md':
        console.log(toMarkdown(data));
        return;
      case 'human':
        console.log(prettyJson(data));
        return;
    }
  }

  // Legacy alias — same as `payload`. Existing callers continue to work.
  json(data: unknown): void {
    this.payload(data);
  }

  success(message: string): void {
    if (this.format === 'agent' || this.format === 'jsonl') {
      console.log(compactJson({ status: 'success', message }));
      return;
    }
    if (this.format === 'json') {
      console.log(prettyJson({ status: 'success', message }));
      return;
    }
    if (this.format === 'yaml') {
      console.log(toYaml({ status: 'success', message }));
      return;
    }
    if (this.format === 'md') {
      console.log(`**OK** — ${message}`);
      return;
    }
    console.log(`${pc.green('✓')} ${message}`);
  }

  error(message: string): void {
    if (this.format === 'agent' || this.format === 'jsonl') {
      console.error(compactJson({ status: 'error', message }));
      return;
    }
    if (this.format === 'json') {
      console.error(prettyJson({ status: 'error', message }));
      return;
    }
    if (this.format === 'yaml') {
      console.error(toYaml({ status: 'error', message }));
      return;
    }
    if (this.format === 'md') {
      console.error(`**ERROR** — ${message}`);
      return;
    }
    console.error(`${pc.red('✗')} ${message}`);
  }

  /**
   * Report an error and exit — the two halves of a failure that must never
   * come apart. `error()` alone leaves the process to exit 0, which reports
   * `{"status":"error"}` to a caller whose `set -e` script then happily
   * continues; that shipped twice (`setup-mcp verify`, `address validate`)
   * before it was caught. Returning `never` makes the omission unwritable:
   * there is no path through `fatal` that doesn't exit.
   *
   * Renders identically to `error()` — it delegates, so the per-format
   * `{"status":"error","message":...}` contract has one implementation and
   * the two cannot drift.
   *
   * Convention for `code`: 2 = bad input (closed enum, malformed value),
   * 1 = operation failed or lookup missed.
   *
   * Use `error()` directly only when the render and the exit are genuinely
   * separate — e.g. `doctor`, `setup-mcp verify` and `address validate`
   * render a verdict first and let the verdict decide the exit.
   */
  fatal(message: string, code = 1): never {
    this.error(message);
    process.exit(code);
  }

  warn(message: string): void {
    if (this.format === 'agent' || this.format === 'jsonl') {
      console.log(compactJson({ status: 'warning', message }));
      return;
    }
    if (this.format === 'json') {
      console.log(prettyJson({ status: 'warning', message }));
      return;
    }
    if (this.format === 'yaml') {
      console.log(toYaml({ status: 'warning', message }));
      return;
    }
    if (this.format === 'md') {
      console.log(`**WARNING** — ${message}`);
      return;
    }
    console.log(`${pc.yellow('!')} ${message}`);
  }

  info(message: string): void {
    // Decorative-only — agents don't need this.
    if (this.format !== 'human') return;
    console.log(`${pc.blue('i')} ${message}`);
  }

  debug(message: string): void {
    if (!this.debugMode) return;
    const ts = new Date().toISOString();
    if (this.format !== 'human') {
      console.error(compactJson({ status: 'debug', timestamp: ts, message }));
      return;
    }
    console.error(`${pc.gray(`[${ts}]`)} ${pc.dim(message)}`);
  }

  spinner(text: string): Ora | null {
    // Spinners are visual noise on non-TTY / agent output.
    if (this.format !== 'human') return null;
    return ora({ text, color: 'cyan' });
  }

  details(pairs: Array<[string, string | undefined]>): void {
    const obj = pairs.reduce<Record<string, string>>((acc, [key, val]) => {
      if (val !== undefined) acc[key.toLowerCase().replace(/\s+/g, '_')] = val;
      return acc;
    }, {});

    if (this.format === 'agent' || this.format === 'jsonl') {
      console.log(compactJson(obj));
      return;
    }
    if (this.format === 'json') {
      console.log(prettyJson(obj));
      return;
    }
    if (this.format === 'yaml') {
      console.log(toYaml(obj));
      return;
    }
    if (this.format === 'md') {
      console.log(toMarkdown(obj));
      return;
    }

    const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
    for (const [key, value] of pairs) {
      if (value === undefined) continue;
      console.log(`  ${pc.bold(key.padEnd(maxKeyLen))}  ${value}`);
    }
  }
}
