import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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

function getChromeExtensionsPath(baseDir: string): string {
  if (process.platform === 'darwin') {
    return join(baseDir, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Extensions');
  }
  if (process.platform === 'win32') {
    return join(baseDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Extensions');
  }
  return join(baseDir, '.config', 'google-chrome', 'Default', 'Extensions');
}

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
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalLocalAppData = process.env.LOCALAPPDATA;

    process.env.HOME = testConfigDir;
    process.env.USERPROFILE = testConfigDir;
    process.env.LOCALAPPDATA = join(testConfigDir, 'AppData', 'Local');

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
    mkdirSync(getChromeExtensionsPath(testConfigDir), { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, 'HOME');
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      Reflect.deleteProperty(process.env, 'USERPROFILE');
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalLocalAppData === undefined) {
      Reflect.deleteProperty(process.env, 'LOCALAPPDATA');
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }

    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('install creates extension directory', async () => {
    await program.parseAsync(['node', 'am', 'extension', 'install']);

    expect(existsSync(join(testConfigDir, 'chrome-extension'))).toBe(true);
  });

  test('install writes manifest.json', async () => {
    await program.parseAsync(['node', 'am', 'extension', 'install']);

    const manifest = JSON.parse(readFileSync(join(testConfigDir, 'chrome-extension', 'manifest.json'), 'utf-8')) as {
      manifest_version: number;
      name: string;
      version: string;
      description: string;
      permissions: string[];
      background: { service_worker: string };
      action: { default_popup: string };
    };

    expect(manifest).toEqual({
      manifest_version: 3,
      name: 'Anima Pay',
      version: '0.1.0',
      description: 'Anima payment card autofill for AI agents',
      permissions: ['activeTab', 'storage'],
      background: { service_worker: 'background.js' },
      action: { default_popup: 'popup.html' },
    });
  });

  test('install writes background.js placeholder', async () => {
    await program.parseAsync(['node', 'am', 'extension', 'install']);

    const backgroundJs = readFileSync(join(testConfigDir, 'chrome-extension', 'background.js'), 'utf-8');
    expect(backgroundJs).toContain("chrome.runtime.onInstalled.addListener(() => { console.log('Anima Pay extension installed'); });");
  });

  test('install writes popup.html placeholder', async () => {
    await program.parseAsync(['node', 'am', 'extension', 'install']);

    const popupHtml = readFileSync(join(testConfigDir, 'chrome-extension', 'popup.html'), 'utf-8');
    expect(popupHtml).toContain('Anima Pay - Extension installed');
  });

  test('install writes extension bridge config', async () => {
    await program.parseAsync(['node', 'am', 'extension', 'install']);

    const bridge = JSON.parse(readFileSync(join(testConfigDir, 'extension-config.json'), 'utf-8')) as {
      installed: boolean;
      extensionDir: string;
      version: string;
      installedAt: string;
    };

    expect(bridge.installed).toBe(true);
    expect(bridge.extensionDir).toBe(join(testConfigDir, 'chrome-extension'));
    expect(bridge.version).toBe('0.1.0');
    expect(Number.isNaN(Date.parse(bridge.installedAt))).toBe(false);
  });

  test('install --force overwrites existing installation', async () => {
    mkdirSync(join(testConfigDir, 'chrome-extension'), { recursive: true });
    writeFileSync(join(testConfigDir, 'chrome-extension', 'manifest.json'), JSON.stringify({ name: 'Old' }, null, 2));
    writeFileSync(join(testConfigDir, 'extension-config.json'), JSON.stringify({
      installed: true,
      extensionDir: join(testConfigDir, 'chrome-extension'),
      version: '0.0.1',
      installedAt: '2020-01-01T00:00:00.000Z',
    }, null, 2));

    await program.parseAsync(['node', 'am', 'extension', 'install', '--force']);

    const manifest = JSON.parse(readFileSync(join(testConfigDir, 'chrome-extension', 'manifest.json'), 'utf-8')) as { name: string; version: string };
    expect(manifest.name).toBe('Anima Pay');
    expect(manifest.version).toBe('0.1.0');
  });

  test('status shows installed extension info', async () => {
    await program.parseAsync(['node', 'am', 'extension', 'install']);

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'am', '--json', 'extension', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      installed: boolean;
      version: string;
      directory: string;
      installedAt: string;
    };

    expect(payload.installed).toBe(true);
    expect(payload.version).toBe('0.1.0');
    expect(payload.directory).toBe(join(testConfigDir, 'chrome-extension'));
    expect(Number.isNaN(Date.parse(payload.installedAt))).toBe(false);
  });

  test('status reports not installed when no config', async () => {
    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'am', '--json', 'extension', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as { installed: boolean };
    expect(payload.installed).toBe(false);
  });
});
