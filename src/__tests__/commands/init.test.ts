import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-init-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

function readAuthConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(testConfigDir, 'auth.json'), 'utf-8'));
}

function readAppConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(testConfigDir, 'config.json'), 'utf-8'));
}

describe('init command', () => {
  let program: Command;
  let origPrompt: typeof globalThis.prompt;

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
    origPrompt = globalThis.prompt;
  });

  afterEach(() => {
    globalThis.prompt = origPrompt;
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('non-interactive mode saves auth config with API key', async () => {
    await program.parseAsync(['node', 'am', 'init', '--non-interactive', '--api-key', 'ak_test_key_12345']);

    const auth = readAuthConfig();
    expect(auth.apiKey).toBe('ak_test_key_12345');
    expect(auth.apiUrl).toBe('https://api.useanima.sh');
  });

  test('non-interactive mode saves app config with defaults', async () => {
    await program.parseAsync(['node', 'am', 'init', '--non-interactive', '--api-key', 'ak_test_key_12345']);

    const config = readAppConfig();
    expect(config.defaultOrg).toBeUndefined();
    expect(config.defaultIdentity).toBeUndefined();
    expect(config.outputFormat).toBe('table');
  });

  test('non-interactive mode errors without --api-key', async () => {
    const errorSpy = mock(() => {});
    const origError = console.error;
    console.error = errorSpy;

    await program.parseAsync(['node', 'am', 'init', '--non-interactive']);

    console.error = origError;
    const output = errorSpy.mock.calls.map((call) => String(call.at(0) ?? '')).join('\n');
    expect(output).toContain('Missing required flag --api-key in non-interactive mode.');
  });

  test('interactive mode saves correct auth config', async () => {
    const responses = ['https://api.useanima.sh', 'ak_test_key_12345', '', '', 'table', 'n'];
    let promptIndex = 0;
    globalThis.prompt = mock(() => responses[promptIndex++] ?? '');

    await program.parseAsync(['node', 'am', 'init']);

    const auth = readAuthConfig();
    expect(auth.apiUrl).toBe('https://api.useanima.sh');
    expect(auth.apiKey).toBe('ak_test_key_12345');
  });

  test('interactive mode saves correct app config', async () => {
    const responses = ['https://api.useanima.sh', 'ak_test_key_12345', 'my-org', 'agent-1', 'yaml', 'y'];
    let promptIndex = 0;
    globalThis.prompt = mock(() => responses[promptIndex++] ?? '');

    await program.parseAsync(['node', 'am', 'init']);

    const config = readAppConfig();
    expect(config.defaultOrg).toBe('my-org');
    expect(config.defaultIdentity).toBe('agent-1');
    expect(config.outputFormat).toBe('yaml');
  });

  test('invalid API key prefix shows error', async () => {
    const errorSpy = mock(() => {});
    const origError = console.error;
    console.error = errorSpy;

    await program.parseAsync(['node', 'am', 'init', '--non-interactive', '--api-key', 'sk_invalid']);

    console.error = origError;
    const output = errorSpy.mock.calls.map((call) => String(call.at(0) ?? '')).join('\n');
    expect(output).toContain('Invalid API key. API key must start with "ak_".');
  });

  test('JSON mode outputs config as JSON', async () => {
    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node',
      'am',
      '--json',
      'init',
      '--non-interactive',
      '--api-key',
      'ak_test_key_12345',
      '--org',
      'my-org',
      '--identity',
      'agent-1',
      '--format',
      'json',
    ]);

    console.log = origLog;

    const jsonOutput = JSON.parse(String(logSpy.mock.calls[0]?.at(0) ?? '{}'));
    expect(jsonOutput.apiUrl).toBe('https://api.useanima.sh');
    expect(jsonOutput.apiKeyConfigured).toBe(true);
    expect(jsonOutput.defaultOrg).toBe('my-org');
    expect(jsonOutput.defaultIdentity).toBe('agent-1');
    expect(jsonOutput.outputFormat).toBe('json');
  });

  test('existing config is preserved and merged', async () => {
    writeFileSync(
      join(testConfigDir, 'auth.json'),
      JSON.stringify({ token: 'existing-token', email: 'user@example.com', apiKey: 'ak_old', apiUrl: 'https://old.example.com' }, null, 2),
    );
    writeFileSync(
      join(testConfigDir, 'config.json'),
      JSON.stringify({ activeProfile: 'prod', profiles: { prod: { apiUrl: 'https://prod.example.com' } } }, null, 2),
    );

    await program.parseAsync([
      'node',
      'am',
      'init',
      '--non-interactive',
      '--api-key',
      'ak_new_key_12345',
      '--api-url',
      'https://api.useanima.sh',
      '--org',
      'org-1',
      '--identity',
      'id-1',
      '--format',
      'table',
    ]);

    const auth = readAuthConfig();
    const config = readAppConfig();

    expect(auth.token).toBe('existing-token');
    expect(auth.email).toBe('user@example.com');
    expect(auth.apiKey).toBe('ak_new_key_12345');
    expect(auth.apiUrl).toBe('https://api.useanima.sh');

    expect(config.activeProfile).toBe('prod');
    expect(config.profiles).toEqual({ prod: { apiUrl: 'https://prod.example.com' } });
    expect(config.defaultOrg).toBe('org-1');
    expect(config.defaultIdentity).toBe('id-1');
    expect(config.outputFormat).toBe('table');
  });
});
