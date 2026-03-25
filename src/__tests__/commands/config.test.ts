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

  describe('config set', () => {
    test('sets a top-level config value', async () => {
      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'set', 'defaultOrg', 'my-org']);
      const config = readAppConfig();
      expect(config.defaultOrg).toBe('my-org');
    });

    test('sets outputFormat value', async () => {
      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'set', 'outputFormat', 'json']);
      const config = readAppConfig();
      expect(config.outputFormat).toBe('json');
    });

    test('sets value in a named profile', async () => {
      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'set', '--profile', 'staging', 'apiUrl', 'https://staging.anima.com']);
      const config = readAppConfig();
      expect((config.profiles as Record<string, Record<string, string>>).staging.apiUrl).toBe('https://staging.anima.com');
    });

    test('rejects invalid config key', async () => {
      const errorSpy = mock(() => {});
      const origError = console.error;
      console.error = errorSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'set', 'invalidKey', 'value']);

      console.error = origError;
      expect(errorSpy).toHaveBeenCalled();
      const errorMsg = errorSpy.mock.calls[0]?.[0] as string;
      expect(errorMsg).toContain('Invalid config key');
    });
  });

  describe('config get', () => {
    test('gets a config value', async () => {
      writeAppConfig({ defaultOrg: 'test-org' });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'get', 'defaultOrg']);

      console.log = origLog;
      expect(logSpy).toHaveBeenCalledWith('test-org');
    });

    test('gets value from specific profile', async () => {
      writeAppConfig({
        profiles: { prod: { apiUrl: 'https://api.anima.com' } },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'get', '--profile', 'prod', 'apiUrl']);

      console.log = origLog;
      expect(logSpy).toHaveBeenCalledWith('https://api.anima.com');
    });

    test('reports error for unset key', async () => {
      writeAppConfig({});

      const errorSpy = mock(() => {});
      const origError = console.error;
      console.error = errorSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'get', 'defaultOrg']);

      console.error = origError;
      expect(errorSpy).toHaveBeenCalled();
    });

    test('resolves env var over config file', async () => {
      writeAppConfig({ defaultOrg: 'file-org' });
      process.env.ANIMA_DEFAULT_ORG = 'env-org';

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'get', 'defaultOrg']);

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
      await program.parseAsync(['node', 'am', 'config', 'list']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('my-org');
    });

    test('lists profiles with --profiles flag', async () => {
      writeAppConfig({
        activeProfile: 'prod',
        profiles: {
          prod: { apiUrl: 'https://api.anima.com', defaultOrg: 'prod-org' },
          staging: { apiUrl: 'https://staging.anima.com' },
        },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'list', '--profiles']);

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
      await program.parseAsync(['node', 'am', 'config', 'list', '--resolved']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('profile-org');
    });
  });

  describe('config profile', () => {
    test('switches to a profile', async () => {
      writeAppConfig({
        profiles: { staging: { apiUrl: 'https://staging.anima.com' } },
      });

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'profile', 'use', 'staging']);

      const config = readAppConfig();
      expect(config.activeProfile).toBe('staging');
    });

    test('errors when switching to nonexistent profile', async () => {
      writeAppConfig({});

      const errorSpy = mock(() => {});
      const origError = console.error;
      console.error = errorSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'profile', 'use', 'nonexistent']);

      console.error = origError;
      expect(errorSpy).toHaveBeenCalled();
    });

    test('deletes a profile', async () => {
      writeAppConfig({
        activeProfile: 'staging',
        profiles: {
          staging: { apiUrl: 'https://staging.anima.com' },
          prod: { apiUrl: 'https://api.anima.com' },
        },
      });

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'profile', 'delete', 'staging']);

      const config = readAppConfig();
      expect((config.profiles as Record<string, unknown>).staging).toBeUndefined();
      expect(config.activeProfile).toBeUndefined();
    });

    test('lists profiles', async () => {
      writeAppConfig({
        activeProfile: 'prod',
        profiles: {
          prod: { apiUrl: 'https://api.anima.com' },
          dev: { apiUrl: 'http://localhost:4001' },
        },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'profile', 'list']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('prod');
      expect(output).toContain('dev');
    });

    test('shows current profile', async () => {
      writeAppConfig({
        activeProfile: 'prod',
        profiles: { prod: { apiUrl: 'https://api.anima.com', defaultOrg: 'prod-org' } },
      });

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;

      program.exitOverride();
      await program.parseAsync(['node', 'am', 'config', 'profile', 'current']);

      console.log = origLog;
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('prod');
      expect(output).toContain('prod-org');
    });
  });
});
