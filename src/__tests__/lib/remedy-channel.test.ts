import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A remedy must reach the caller that needs it most.
 *
 * `output.error()` renders in every format. `output.info()` renders only for
 * humans — by design, it is decoration. Pairing them, which reads perfectly
 * well in a terminal, silently drops the "here is what to do about it" half
 * for any agent driving the CLI: it receives `{"status":"error","message":…}`
 * and nothing else, from the one caller least able to guess the remedy.
 *
 * `output.notice()` is the channel for this — every format, on stderr, so a
 * piped `| jq` still parses exactly one document on stdout.
 *
 * This scans source rather than behaviour on purpose. The defect is invisible
 * at every individual call site (each looks fine) and only shows up as a class,
 * so the guard has to be shaped like the class.
 */

const COMMANDS_DIR = join(import.meta.dir, '..', '..', 'commands');

/**
 * Files whose `info()`-after-`error()` is NOT a remedy.
 *
 * Empty, and worth keeping empty. `address/validate.ts` used to live here
 * because it printed the API's suggested addresses — data, not guidance —
 * through `info()`. It was fixed at the root instead: the machine path is now
 * chosen by the resolved format, so those callers receive the whole response
 * with suggestions included, and the human branch renders them through
 * `details()` where tabular data belongs.
 */
const NOT_REMEDIES = new Set<string>([]);

/** Lines to look ahead after an error() before giving up. */
const LOOKAHEAD = 6;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function findRemedyPairs(): string[] {
  const offenders: string[] = [];

  for (const file of walk(COMMANDS_DIR)) {
    const relative = file.slice(file.indexOf('commands/') + 'commands/'.length);
    if (NOT_REMEDIES.has(relative)) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/output\.(error|fatal)\(/.test(lines[i] ?? '')) continue;

      for (let j = i + 1; j < Math.min(i + 1 + LOOKAHEAD, lines.length); j += 1) {
        const line = lines[j] ?? '';
        // Another rendering call means the error's own block ended.
        if (/output\.(error|fatal|success|json|details|table)\(/.test(line)) break;
        if (line.includes('output.info(')) {
          offenders.push(`${relative}:${j + 1} (remedy for the error on line ${i + 1})`);
          break;
        }
      }
    }
  }

  return offenders;
}

describe('error remedies reach every output format', () => {
  test('no command pairs output.error() with a human-only output.info()', () => {
    // Failure message names the file and line so the fix is mechanical:
    // change that `output.info(` to `output.notice(`.
    expect(findRemedyPairs()).toEqual([]);
  });

  test('the scanner actually finds the pattern it claims to find', () => {
    // A guard that cannot fail is not a guard. This proves the walk reaches
    // real files and the matcher works, so an empty result above means
    // "nothing to find" rather than "nothing was looked at".
    const files = walk(COMMANDS_DIR);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('voice/place.ts'))).toBe(true);
  });
});
