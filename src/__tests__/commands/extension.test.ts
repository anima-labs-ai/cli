import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-extension-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

function parseLastJsonLog(logSpy: ReturnType<typeof mock>): unknown {
  const calls = logSpy.mock.calls;
  const last = calls[calls.length - 1];
  const firstArg = last?.[0];
  if (typeof firstArg !== 'string') {
    return undefined;
  }
  return JSON.parse(firstArg);
}

describe('extension commands', () => {
  let program: Command;

  beforeEach(() => {
    resetPathsCache();
    setPathsOverride({
      config: testConfigDir,
      data: testConfigDir,
      cache: testConfigDir,
      log: testConfigDir,
      temp: testConfigDir,
    });
    program = createProgram();
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('status shows installed extension info when bridge config is present', async () => {
    // Seed the bridge config + a real extension directory. Previously this
    // was set up by `am extension install` (now removed); the extension
    // ships out-of-band, so the test directly fakes the on-disk state the
    // status command reads.
    const extensionDir = join(testConfigDir, 'chrome-extension');
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(
      join(testConfigDir, 'extension-config.json'),
      JSON.stringify(
        {
          installed: true,
          extensionDir,
          version: '0.1.0',
          installedAt: '2026-05-06T00:00:00.000Z',
        },
        null,
        2,
      ),
    );

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'extension', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      installed: boolean;
      version: string;
      directory: string;
      installedAt: string;
    };

    expect(payload.installed).toBe(true);
    expect(payload.version).toBe('0.1.0');
    expect(payload.directory).toBe(extensionDir);
    expect(payload.installedAt).toBe('2026-05-06T00:00:00.000Z');
  });

  test('status reports not installed when no config', async () => {
    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'extension', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as { installed: boolean };
    expect(payload.installed).toBe(false);
  });
});
