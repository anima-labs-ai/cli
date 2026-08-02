import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Output, type OutputFormat } from '../../lib/output.js';

/**
 * Which path a command takes — structured document or prose — must follow the
 * RESOLVED format, never the raw `--json` flag.
 *
 * `--json` is one of five ways to ask for structure, and it is not the common
 * one: `resolveFormat` returns `agent` whenever stdout is not a TTY, so every
 * piped or redirected invocation arrives with `globals.json` undefined.
 * Commands that branched on the flag therefore sent `am … | jq` down the human
 * path, where `output.info()` renders nothing — silent data loss, not a
 * cosmetic difference.
 */

function make(options: {
  json?: boolean;
  human?: boolean;
  format?: OutputFormat;
}): Output {
  return new Output({
    json: options.json ?? false,
    human: options.human ?? false,
    format: options.format,
    debug: false,
  });
}

describe('Output.isMachineFormat', () => {
  test('is true for every format except human', () => {
    const machine: OutputFormat[] = ['agent', 'json', 'yaml', 'jsonl', 'md'];
    for (const format of machine) {
      expect(make({ format }).isMachineFormat()).toBe(true);
    }
    expect(make({ format: 'human' }).isMachineFormat()).toBe(false);
    expect(make({ human: true }).isMachineFormat()).toBe(false);
  });

  test('the legacy --json flag still selects the structured path', () => {
    expect(make({ json: true }).isMachineFormat()).toBe(true);
    expect(make({ json: true }).format).toBe('json');
  });

  test('a caller with no flags gets the structured path', () => {
    // The case the whole change turns on. Tests force `agent` exactly as a
    // non-TTY stdout does, so this is a piped `am … | jq` with no flags — the
    // invocation that used to fall through to the human branch.
    const output = make({});
    expect(output.format).toBe('agent');
    expect(output.isMachineFormat()).toBe(true);
  });
});

describe('Output.wantsEnvelope', () => {
  /**
   * A handful of commands emit a payload that is ALREADY machine-consumable —
   * a bare scalar (`config get`), a proxied upstream body (`vault use`),
   * rendered text (`vault inject`, `vault redact`). For those the envelope has
   * to be opt-in, because `ORG=$(am config get defaultOrg)` and
   * `am vault use … > out.bin` both break the moment we wrap the payload.
   */
  test('an explicit format request asks for the envelope', () => {
    expect(make({ json: true }).wantsEnvelope()).toBe(true);
    expect(make({ format: 'json' }).wantsEnvelope()).toBe(true);
    expect(make({ format: 'yaml' }).wantsEnvelope()).toBe(true);
    expect(make({ format: 'agent' }).wantsEnvelope()).toBe(true);
  });

  test('the TTY-derived default never does', () => {
    // No flags: `isMachineFormat` says yes (give them structure where the
    // alternative is prose), `wantsEnvelope` says no (leave the raw payload
    // alone). This one disagreement is the entire reason both exist.
    const output = make({});
    expect(output.isMachineFormat()).toBe(true);
    expect(output.wantsEnvelope()).toBe(false);
  });

  test('an explicit --human never does either', () => {
    expect(make({ human: true }).wantsEnvelope()).toBe(false);
    expect(make({ format: 'human' }).wantsEnvelope()).toBe(false);
  });
});

/**
 * The structural half. 108 files were converted at once; without a guard the
 * next command copied from an old template quietly reintroduces the bug, and
 * nothing fails until someone pipes that one command.
 */
describe('no command gates output on the raw --json flag', () => {
  const COMMANDS_DIR = join(import.meta.dir, '..', '..', 'commands');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  test('`globals.json` appears only where an Output is constructed', () => {
    const offenders: string[] = [];
    for (const file of walk(COMMANDS_DIR)) {
      const relative = file.slice(file.indexOf('commands/') + 'commands/'.length);
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!line.includes('globals.json')) return;
          // `json: globals.json ?? false` feeds resolveFormat — that is the ONE
          // legitimate reading of the flag, and it is not a branch.
          if (/^\s*json:\s*globals\.json/.test(line)) return;
          offenders.push(`${relative}:${index + 1}  ${line.trim()}`);
        });
    }
    // Use `output.isMachineFormat()` — or `output.wantsEnvelope()` when the
    // command's plain output is already a machine payload.
    expect(offenders).toEqual([]);
  });

  test('the scanner reaches real files', () => {
    // A guard that cannot fail is not a guard.
    const files = walk(COMMANDS_DIR);
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.endsWith('config/get.ts'))).toBe(true);
  });
});
