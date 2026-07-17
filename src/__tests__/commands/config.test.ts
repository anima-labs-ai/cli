import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-config-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

describe('config commands', () => {
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

  function readAppConfig(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(testConfigDir, 'config.json'), 'utf-8'));
  }

  function writeAppConfig(config: Record<string, unknown>): void {
    writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify(config, null, 2));
  }

  /**
   * Run a command that is expected to fail, capturing what the user sees and
   * the code the shell gets. `process.exit` throws here so the handler stops
   * where a real exit would — otherwise the action runs on past the error and
   * e.g. writes the key it just rejected.
   */
  async function runCapturingExit(
    argv: string[],
  ): Promise<{ code: number | undefined; message: string }> {
    const errorSpy = mock(() => {});
    const origError = console.error;
    const origExit = process.exit;
    let code: number | undefined;

    console.error = errorSpy;
    process.exit = ((c?: number) => {
      code = c;
      throw new Error('__exit__');
    }) as unknown as typeof process.exit;

    program.exitOverride();
    try {
      await program.parseAsync(['node', 'anima', ...argv]);
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.message !== '__exit__') throw error;
    } finally {
      console.error = origError;
      process.exit = origExit;
    }

    return {
      code,
      message: errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n'),
    };
  }

  describe('config set', () => {
    test('sets a top-level config value', async () => {
      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'set', 'defaultOrg', 'my-org']);
      const config = readAppConfig();
      expect(config.defaultOrg).toBe('my-org');
    });

    test('sets outputFormat value', async () => {
      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'set', 'outputFormat', 'json']);
      const config = readAppConfig();
      expect(config.outputFormat).toBe('json');
    });

    test('sets value in a named profile', async () => {
      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'set', '--profile', 'staging', 'apiUrl', 'https://staging.useanima.sh']);
      const config = readAppConfig();
      expect((config.profiles as Record<string, Record<string, string>>).staging.apiUrl).toBe('https://staging.useanima.sh');
    });

    test('rejects invalid config key', async () => {
      const { code, message } = await runCapturingExit([
        'config', 'set', 'invalidKey', 'value',
      ]);

      expect(message).toContain('Invalid config key');
      // Bad input, so 2 — matching `generate`, `completion` and `voice place`.
      // Without this the shell is told the set succeeded.
      expect(code).toBe(2);
    });
  });

  describe('config get', () => {
    test('gets a config value', async () => {
      writeAppConfig({ defaultOrg: 'test-org' });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'get', 'defaultOrg']);

      console.log = origLog;
      expect(logSpy).toHaveBeenCalledWith('test-org');
    });

    test('gets value from specific profile', async () => {
      writeAppConfig({
        profiles: { prod: { apiUrl: 'https://api.useanima.sh' } },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'get', '--profile', 'prod', 'apiUrl']);

      console.log = origLog;
      expect(logSpy).toHaveBeenCalledWith('https://api.useanima.sh');
    });

    test('reports error for unset key', async () => {
      writeAppConfig({});

      const { code, message } = await runCapturingExit(['config', 'get', 'defaultOrg']);

      expect(message).toContain('is not set');
      // A lookup miss, not bad input — 1, like `git config --get` on a key
      // that isn't there.
      expect(code).toBe(1);
    });

    test('resolves env var over config file', async () => {
      writeAppConfig({ defaultOrg: 'file-org' });
      process.env.ANIMA_DEFAULT_ORG = 'env-org';

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'get', 'defaultOrg']);

      console.log = origLog;
      Reflect.deleteProperty(process.env, 'ANIMA_DEFAULT_ORG');
      expect(logSpy).toHaveBeenCalledWith('env-org');
    });
  });

  describe('config list', () => {
    test('lists all config values', async () => {
      writeAppConfig({
        defaultOrg: 'my-org',
        defaultIdentity: 'agent-1',
        outputFormat: 'table',
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'list']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('my-org');
    });

    test('lists profiles with --profiles flag', async () => {
      writeAppConfig({
        activeProfile: 'prod',
        profiles: {
          prod: { apiUrl: 'https://api.useanima.sh', defaultOrg: 'prod-org' },
          staging: { apiUrl: 'https://staging.useanima.sh' },
        },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'list', '--profiles']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('prod');
      expect(output).toContain('staging');
    });

    test('shows resolved values with --resolved flag', async () => {
      writeAppConfig({
        defaultOrg: 'config-org',
        activeProfile: 'dev',
        profiles: { dev: { defaultOrg: 'profile-org' } },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'list', '--resolved']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('profile-org');
    });
  });

  describe('config profile', () => {
    test('switches to a profile', async () => {
      writeAppConfig({
        profiles: { staging: { apiUrl: 'https://staging.useanima.sh' } },
      });

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'profile', 'use', 'staging']);

      const config = readAppConfig();
      expect(config.activeProfile).toBe('staging');
    });

    test('errors when switching to nonexistent profile', async () => {
      writeAppConfig({});

      const { code, message } = await runCapturingExit([
        'config', 'profile', 'use', 'nonexistent',
      ]);

      expect(message).toContain('does not exist');
      expect(code).toBe(1);
    });

    test('deletes a profile', async () => {
      writeAppConfig({
        activeProfile: 'staging',
        profiles: {
          staging: { apiUrl: 'https://staging.useanima.sh' },
          prod: { apiUrl: 'https://api.useanima.sh' },
        },
      });

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'profile', 'delete', 'staging']);

      const config = readAppConfig();
      expect((config.profiles as Record<string, unknown>).staging).toBeUndefined();
      expect(config.activeProfile).toBeUndefined();
    });

    test('lists profiles', async () => {
      writeAppConfig({
        activeProfile: 'prod',
        profiles: {
          prod: { apiUrl: 'https://api.useanima.sh' },
          dev: { apiUrl: 'http://localhost:4001' },
        },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'profile', 'list']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('prod');
      expect(output).toContain('dev');
    });

    test('shows current profile', async () => {
      writeAppConfig({
        activeProfile: 'prod',
        profiles: { prod: { apiUrl: 'https://api.useanima.sh', defaultOrg: 'prod-org' } },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'anima', 'config', 'profile', 'current']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('prod');
      expect(output).toContain('prod-org');
    });
  });

  /**
   * WHY: printing `{"status":"error"}` and then exiting 0 is a lie the shell
   * believes. `anima config set … && deploy` would deploy on a rejected key;
   * `set -e` scripts and CI sail through a real failure. The tests above this
   * block assert the *message* and pass either way — which is exactly how this
   * shipped. The exit code is the part a script can actually see.
   *
   * Code follows the convention already in the CLI: 2 = the input was bad
   * (`generate` unknown kind, `completion` unsupported shell, `voice place`
   * malformed --to), 1 = the input was fine but the operation failed.
   */
  describe('error paths exit non-zero', () => {
    test('config set rejects an empty key with exit 2', async () => {
      writeAppConfig({});
      const { code } = await runCapturingExit(['config', 'set', '', 'value']);
      expect(code).toBe(2);
    });

    test('config set does not persist a rejected key', async () => {
      // The rejection must also not leave the bad key in the file — the exit
      // is what stops the write.
      writeAppConfig({});
      await runCapturingExit(['config', 'set', 'invalidKey', 'value']);
      expect(readAppConfig().invalidKey).toBeUndefined();
    });

    test('config get rejects an invalid key with exit 2', async () => {
      writeAppConfig({});
      const { code, message } = await runCapturingExit(['config', 'get', 'invalidKey']);
      expect(message).toContain('Invalid config key');
      expect(code).toBe(2);
    });

    test('config get exits 1 when the key is not set in the named profile', async () => {
      writeAppConfig({ profiles: { prod: { defaultOrg: 'prod-org' } } });
      const { code, message } = await runCapturingExit([
        'config', 'get', '--profile', 'prod', 'apiUrl',
      ]);
      expect(message).toContain('not set in profile');
      expect(code).toBe(1);
    });

    test('config profile delete exits 1 for an unknown profile', async () => {
      writeAppConfig({});
      const { code, message } = await runCapturingExit([
        'config', 'profile', 'delete', 'nonexistent',
      ]);
      expect(message).toContain('does not exist');
      expect(code).toBe(1);
    });
  });
});
