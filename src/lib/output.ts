import pc from 'picocolors';
import Table from 'cli-table3';
import ora, { type Ora } from 'ora';

export interface OutputOptions {
  json: boolean;
  debug: boolean;
}

export class Output {
  private readonly jsonMode: boolean;
  private readonly debugMode: boolean;

  constructor(options: OutputOptions) {
    this.jsonMode = options.json;
    this.debugMode = options.debug;
  }

  table(headers: string[], rows: string[][]): void {
    if (this.jsonMode) {
      const objects = rows.map((row) =>
        headers.reduce<Record<string, string>>((obj, header, i) => {
          obj[header.toLowerCase().replace(/\s+/g, '_')] = row[i] ?? '';
          return obj;
        }, {})
      );
      console.log(JSON.stringify(objects, null, 2));
      return;
    }

    const table = new Table({
      head: headers.map((h) => pc.bold(pc.cyan(h))),
      style: { head: [], border: [] },
    });

    for (const row of rows) {
      table.push(row);
    }

    console.log(table.toString());
  }

  json(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  }

  success(message: string): void {
    if (this.jsonMode) {
      console.log(JSON.stringify({ status: 'success', message }));
      return;
    }
    console.log(`${pc.green('✓')} ${message}`);
  }

  error(message: string): void {
    if (this.jsonMode) {
      console.error(JSON.stringify({ status: 'error', message }));
      return;
    }
    console.error(`${pc.red('✗')} ${message}`);
  }

  warn(message: string): void {
    if (this.jsonMode) {
      console.log(JSON.stringify({ status: 'warning', message }));
      return;
    }
    console.log(`${pc.yellow('!')} ${message}`);
  }

  info(message: string): void {
    if (this.jsonMode) return;
    console.log(`${pc.blue('i')} ${message}`);
  }

  debug(message: string): void {
    if (!this.debugMode) return;
    const ts = new Date().toISOString();
    if (this.jsonMode) {
      console.error(JSON.stringify({ status: 'debug', timestamp: ts, message }));
      return;
    }
    console.error(`${pc.gray(`[${ts}]`)} ${pc.dim(message)}`);
  }

  spinner(text: string): Ora | null {
    if (this.jsonMode) return null;
    return ora({ text, color: 'cyan' });
  }

  details(pairs: Array<[string, string | undefined]>): void {
    if (this.jsonMode) {
      const obj = pairs.reduce<Record<string, string>>((acc, [key, val]) => {
        if (val !== undefined) acc[key.toLowerCase().replace(/\s+/g, '_')] = val;
        return acc;
      }, {});
      console.log(JSON.stringify(obj, null, 2));
      return;
    }

    const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
    for (const [key, value] of pairs) {
      if (value === undefined) continue;
      console.log(`  ${pc.bold(key.padEnd(maxKeyLen))}  ${value}`);
    }
  }
}
