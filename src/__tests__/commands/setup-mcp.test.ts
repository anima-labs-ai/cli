import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createProgram } from '../../cli.js';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-setup-mcp-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

function claudeDesktopPath(baseDir: string): string {
  if (isWindows) return join(baseDir, 'AppData', 'Claude', 'claude_desktop_config.json');
  if (isMac) return join(baseDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return join(baseDir, '.config', 'Claude', 'claude_desktop_config.json');
}

function claudeDesktopDir(baseDir: string): string {
  return dirname(claudeDesktopPath(baseDir));
}

function cursorPath(baseDir: string): string {
  return join(baseDir, '.cursor', 'mcp.json');
}

function windsurfPath(baseDir: string): string {
  return join(baseDir, '.codeium', 'windsurf', 'mcp_config.json');
}

function vscodePath(baseDir: string): string {
  if (isWindows) return join(baseDir, 'AppData', 'Code', 'User', 'mcp.json');
  if (isMac) return join(baseDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  return join(baseDir, '.config', 'Code', 'User', 'mcp.json');
}

function vscodeDir(baseDir: string): string {
  return dirname(vscodePath(baseDir));
}

function claudeCodePath(baseDir: string): string {
  return join(baseDir, '.claude.json');
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

describe('setup-mcp commands', () => {
  let program: Command;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAppData: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAppData = process.env.APPDATA;

    process.env.HOME = testConfigDir;
    process.env.USERPROFILE = testConfigDir;
    process.env.APPDATA = join(testConfigDir, 'AppData');

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
    writeFileSync(join(testConfigDir, 'auth.json'), JSON.stringify({ apiKey: 'ak_stored_123' }, null, 2));
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.APPDATA = originalAppData;

    rmSync(testConfigDir, { recursive: true, force: true });
  });

  test('detects installed clients based on config directories', async () => {
    mkdirSync(claudeDesktopDir(testConfigDir), { recursive: true });
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'setup-mcp', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as { clients: Array<{ client: string; detected: boolean }> };
    const byName = new Map(payload.clients.map((row) => [row.client, row.detected]));
    expect(byName.get('Claude Desktop')).toBe(true);
    expect(byName.get('Cursor')).toBe(true);
    expect(byName.get('Windsurf')).toBe(false);
  });

  test('install writes correct config for Claude Desktop', async () => {
    const target = claudeDesktopPath(testConfigDir);
    mkdirSync(claudeDesktopDir(testConfigDir), { recursive: true });

    await program.parseAsync(['node', 'anima', 'setup-mcp', 'install', '--client', 'claude-desktop']);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: { ANIMA_API_KEY: string } }>;
    };
    expect(saved.mcpServers['anima-agent'].command).toBe('npx');
    expect(saved.mcpServers['anima-agent'].args).toEqual(['-y', '@anima-labs/mcp-agent']);
    expect(saved.mcpServers['anima-agent'].env.ANIMA_API_KEY).toBe('ak_stored_123');
    expect(saved.mcpServers['anima-email']).toBeDefined();
    expect(saved.mcpServers['anima-phone']).toBeDefined();
    expect(saved.mcpServers['anima-cards']).toBeDefined();
    expect(saved.mcpServers['anima-vault']).toBeDefined();
    expect(saved.mcpServers['anima-platform']).toBeDefined();
  });

  test('install writes correct config for Cursor', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    await program.parseAsync(['node', 'anima', 'setup-mcp', 'install', '--client', 'cursor']);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: { ANIMA_API_KEY: string } }>;
    };
    expect(saved.mcpServers['anima-agent'].command).toBe('npx');
    expect(saved.mcpServers['anima-agent'].args).toEqual(['-y', '@anima-labs/mcp-agent']);
    expect(saved.mcpServers['anima-agent'].env.ANIMA_API_KEY).toBe('ak_stored_123');
  });

  test('install merges into existing config without overwriting', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      foo: 'bar',
      mcpServers: {
        existing: { command: 'node', args: ['existing.js'] },
      },
    }, null, 2));

    await program.parseAsync(['node', 'anima', 'setup-mcp', 'install', '--client', 'cursor']);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      foo: string;
      mcpServers: Record<string, unknown>;
    };
    expect(saved.foo).toBe('bar');
    expect(saved.mcpServers.existing).toBeDefined();
    expect(saved.mcpServers['anima-agent']).toBeDefined();
  });

  test('install creates backup before modifying existing config', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(target, JSON.stringify({ mcpServers: { existing: { command: 'node' } } }, null, 2));

    await program.parseAsync(['node', 'anima', 'setup-mcp', 'install', '--client', 'cursor']);

    expect(existsSync(`${target}.bak`)).toBe(true);
    const backup = JSON.parse(readFileSync(`${target}.bak`, 'utf-8')) as {
      mcpServers: { existing: { command: string } };
    };
    expect(backup.mcpServers.existing.command).toBe('node');
  });

  test('uninstall removes anima entry', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      mcpServers: {
        anima: { command: 'bunx', args: ['@anima/mcp'] },
        existing: { command: 'node' },
      },
    }, null, 2));

    await program.parseAsync(['node', 'anima', 'setup-mcp', 'uninstall', '--client', 'cursor']);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(saved.mcpServers.anima).toBeUndefined();
    expect(saved.mcpServers.existing).toBeDefined();
  });

  test('status shows configured and unconfigured clients', async () => {
    const cursor = cursorPath(testConfigDir);
    const windsurf = windsurfPath(testConfigDir);
    const vscode = vscodePath(testConfigDir);
    const claudeCode = claudeCodePath(testConfigDir);

    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    mkdirSync(join(testConfigDir, '.codeium', 'windsurf'), { recursive: true });
    mkdirSync(vscodeDir(testConfigDir), { recursive: true });
    writeFileSync(cursor, JSON.stringify({ mcpServers: { anima: { command: 'bunx' } } }, null, 2));
    writeFileSync(windsurf, JSON.stringify({ mcpServers: {} }, null, 2));
    writeFileSync(vscode, JSON.stringify({ servers: {} }, null, 2));
    writeFileSync(claudeCode, JSON.stringify({ mcpServers: {} }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'setup-mcp', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      clients: Array<{ client: string; configured: boolean }>;
    };
    const byName = new Map(payload.clients.map((row) => [row.client, row.configured]));
    expect(byName.get('Cursor')).toBe(true);
    expect(byName.get('Windsurf')).toBe(false);
    expect(byName.get('VS Code')).toBe(false);
  });

  test('--api-key flag overrides stored key', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'cursor', '--api-key', 'ak_override_999',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, { env: { ANIMA_API_KEY: string } }>;
    };
    expect(saved.mcpServers['anima-agent'].env.ANIMA_API_KEY).toBe('ak_override_999');
  });

  test('errors on invalid client name', async () => {
    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync(['node', 'anima', 'setup-mcp', 'install', '--client', 'invalid-client']);
    } catch {
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('install --mode remote writes mcp-remote config for Claude Desktop', async () => {
    const target = claudeDesktopPath(testConfigDir);
    mkdirSync(claudeDesktopDir(testConfigDir), { recursive: true });

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'claude-desktop', '--mode', 'remote',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        command: string;
        args: string[];
        env: { ANIMA_TOKEN: string };
      }>;
    };
    const entry = saved.mcpServers['anima-agent'];
    expect(entry.command).toBe('npx');
    expect(entry.args).toContain('mcp-remote');
    expect(entry.args).toContain('https://mcp-agent-829045119779.us-central1.run.app/mcp');
    expect(entry.args).toContain('--header');
    expect(entry.args).toContain('Authorization:${ANIMA_TOKEN}');
    expect(entry.env.ANIMA_TOKEN).toBe('Bearer ak_stored_123');
  });

  test('install --mode remote with --url uses custom endpoint for Cursor (native HTTP)', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install',
      '--client', 'cursor',
      '--mode', 'remote',
      '--url', 'https://custom.example.com/mcp',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        url: string;
        headers: Record<string, string>;
      }>;
    };
    expect(saved.mcpServers['anima-agent'].url).toBe('https://custom.example.com/mcp');
    expect(saved.mcpServers['anima-agent'].headers.Authorization).toBe('Bearer ak_stored_123');
  });

  test('install --mode remote with --api-key uses override key in Bearer token', async () => {
    const target = claudeDesktopPath(testConfigDir);
    mkdirSync(claudeDesktopDir(testConfigDir), { recursive: true });

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install',
      '--client', 'claude-desktop',
      '--mode', 'remote',
      '--api-key', 'ak_custom_456',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        command: string;
        args: string[];
        env: { ANIMA_TOKEN: string };
      }>;
    };
    expect(saved.mcpServers['anima-agent'].env.ANIMA_TOKEN).toBe('Bearer ak_custom_456');
  });

  test('install --mode stdio (default) writes standard npx config', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'cursor', '--mode', 'stdio',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        command: string;
        args: string[];
        env: { ANIMA_API_KEY: string };
      }>;
    };
    expect(saved.mcpServers['anima-agent'].command).toBe('npx');
    expect(saved.mcpServers['anima-agent'].args).toEqual(['-y', '@anima-labs/mcp-agent']);
    expect(saved.mcpServers['anima-agent'].env.ANIMA_API_KEY).toBe('ak_stored_123');
  });

  test('install --mode remote writes native HTTP config for Cursor', async () => {
    const target = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'cursor', '--mode', 'remote',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        url: string;
        headers: Record<string, string>;
      }>;
    };
    const entry = saved.mcpServers['anima-agent'];
    expect(entry.url).toBe('https://mcp-agent-829045119779.us-central1.run.app/mcp');
    expect(entry.headers.Authorization).toBe('Bearer ak_stored_123');
    expect((entry as unknown as Record<string, unknown>).command).toBeUndefined();
  });

  test('install --mode remote writes native HTTP config for Windsurf', async () => {
    mkdirSync(join(testConfigDir, '.codeium', 'windsurf'), { recursive: true });
    const target = windsurfPath(testConfigDir);

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'windsurf', '--mode', 'remote',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        serverUrl: string;
        headers: Record<string, string>;
      }>;
    };
    const entry = saved.mcpServers['anima-agent'];
    expect(entry.serverUrl).toBe('https://mcp-agent-829045119779.us-central1.run.app/mcp');
    expect(entry.headers.Authorization).toBe('Bearer ${env:ANIMA_API_KEY}');
    expect((entry as unknown as Record<string, unknown>).url).toBeUndefined();
  });

  test('install --mode remote writes native HTTP config for VS Code with inputs', async () => {
    mkdirSync(vscodeDir(testConfigDir), { recursive: true });
    const target = vscodePath(testConfigDir);

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'vscode', '--mode', 'remote',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      servers: Record<string, {
        type: string;
        url: string;
        headers: Record<string, string>;
      }>;
      inputs: Array<{ id: string; type: string; description: string; password: boolean }>;
    };
    const entry = saved.servers['anima-agent'];
    expect(entry.type).toBe('http');
    expect(entry.url).toBe('https://mcp-agent-829045119779.us-central1.run.app/mcp');
    expect(entry.headers.Authorization).toBe('Bearer ${input:anima-key}');
    expect(saved.inputs).toBeDefined();
    expect(saved.inputs.length).toBe(1);
    expect(saved.inputs[0].id).toBe('anima-key');
    expect(saved.inputs[0].password).toBe(true);
  });

  test('install --mode remote writes native HTTP config for Claude Code', async () => {
    const target = claudeCodePath(testConfigDir);

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'claude-code', '--mode', 'remote',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      mcpServers: Record<string, {
        type: string;
        url: string;
        headers: Record<string, string>;
      }>;
    };
    const entry = saved.mcpServers['anima-agent'];
    expect(entry.type).toBe('http');
    expect(entry.url).toBe('https://mcp-agent-829045119779.us-central1.run.app/mcp');
    expect(entry.headers.Authorization).toBe('Bearer ${ANIMA_API_KEY}');
  });

  test('install --mode remote does not duplicate VS Code inputs on repeated install', async () => {
    mkdirSync(vscodeDir(testConfigDir), { recursive: true });
    const target = vscodePath(testConfigDir);

    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'vscode', '--mode', 'remote',
    ]);
    await program.parseAsync([
      'node', 'anima', 'setup-mcp', 'install', '--client', 'vscode', '--mode', 'remote',
    ]);

    const saved = JSON.parse(readFileSync(target, 'utf-8')) as {
      inputs: Array<{ id: string }>;
    };
    const animaInputs = saved.inputs.filter((i) => i.id === 'anima-key');
    expect(animaInputs.length).toBe(1);
  });

  test('--url without --mode remote errors', async () => {
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    const exitSpy = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock(() => {});
    const originalError = console.error;
    console.error = errorSpy;

    try {
      await program.parseAsync([
        'node', 'anima', 'setup-mcp', 'install',
        '--client', 'cursor',
        '--url', 'https://custom.example.com/mcp',
      ]);
    } catch {
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('install --mode remote --json includes mode and urls in output', async () => {
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'install',
      '--client', 'cursor',
      '--mode', 'remote',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      configured: string[];
      count: number;
      mode: string;
      servers: string[];
      urls: string[];
    };
    expect(payload.mode).toBe('remote');
    expect(payload.servers).toEqual(['agent', 'email', 'phone', 'cards', 'vault', 'platform']);
    expect(payload.urls.length).toBe(6);
    expect(payload.urls[0]).toBe('https://mcp-agent-829045119779.us-central1.run.app/mcp');
    expect(payload.count).toBe(1);
  });

  test('status shows mode for configured clients', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'https://mcp.useanima.sh/mcp', '--header', 'Authorization:${ANIMA_TOKEN}'],
          env: { ANIMA_TOKEN: 'Bearer ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'setup-mcp', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      clients: Array<{ client: string; mode: string; url: string | null; configured: boolean }>;
    };
    const cursorRow = payload.clients.find((c) => c.client === 'Cursor');
    expect(cursorRow).toBeDefined();
    expect(cursorRow?.mode).toBe('remote');
    expect(cursorRow?.url).toBe('https://mcp.useanima.sh/mcp');
    expect(cursorRow?.configured).toBe(true);
  });

  test('status shows stdio mode for standard config', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'bunx',
          args: ['@anima/mcp'],
          env: { ANIMA_API_KEY: 'ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'setup-mcp', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      clients: Array<{ client: string; mode: string; url: string | null }>;
    };
    const cursorRow = payload.clients.find((c) => c.client === 'Cursor');
    expect(cursorRow?.mode).toBe('stdio');
    expect(cursorRow?.url).toBeNull();
  });

  test('verify detects valid remote config', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'https://mcp.useanima.sh/mcp', '--header', 'Authorization:${ANIMA_TOKEN}'],
          env: { ANIMA_TOKEN: 'Bearer ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'cursor',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; mode: string; issues: string[] }>;
    };
    expect(payload.results.length).toBe(1);
    expect(payload.results[0].status).toBe('ok');
    expect(payload.results[0].mode).toBe('remote');
    expect(payload.results[0].issues).toEqual([]);
  });

  test('verify detects valid stdio config', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'bunx',
          args: ['@anima/mcp'],
          env: { ANIMA_API_KEY: 'ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'cursor',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; mode: string; issues: string[] }>;
    };
    expect(payload.results[0].status).toBe('ok');
    expect(payload.results[0].mode).toBe('stdio');
  });

  test('verify detects missing API key in stdio config', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'bunx',
          args: ['@anima/mcp'],
          env: {},
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'cursor',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; issues: string[] }>;
    };
    expect(payload.results[0].status).toBe('error');
    expect(payload.results[0].issues).toContain('missing ANIMA_API_KEY in env');
  });

  test('verify detects missing Bearer prefix in remote config', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'https://mcp.useanima.sh/mcp', '--header', 'Authorization:${ANIMA_TOKEN}'],
          env: { ANIMA_TOKEN: 'ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'cursor',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; issues: string[] }>;
    };
    expect(payload.results[0].status).toBe('error');
    expect(payload.results[0].issues).toContain('ANIMA_TOKEN must start with "Bearer "');
  });

  test('verify --all checks all configured clients', async () => {
    const cursor = cursorPath(testConfigDir);
    const claudeDesktop = claudeDesktopPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    mkdirSync(claudeDesktopDir(testConfigDir), { recursive: true });

    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'bunx',
          args: ['@anima/mcp'],
          env: { ANIMA_API_KEY: 'ak_test_123' },
        },
      },
    }, null, 2));

    writeFileSync(claudeDesktop, JSON.stringify({
      mcpServers: {
        anima: {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'https://mcp.useanima.sh/mcp', '--header', 'Authorization:${ANIMA_TOKEN}'],
          env: { ANIMA_TOKEN: 'Bearer ak_test_456' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--all',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; mode: string }>;
    };
    expect(payload.results.length).toBe(2);
    expect(payload.results.every((r) => r.status === 'ok')).toBe(true);
  });

  test('verify detects valid native HTTP config (Cursor url field)', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          url: 'https://mcp.useanima.sh/mcp',
          headers: { Authorization: 'Bearer ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'cursor',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; mode: string; issues: string[] }>;
    };
    expect(payload.results[0].status).toBe('ok');
    expect(payload.results[0].mode).toBe('remote');
    expect(payload.results[0].issues).toEqual([]);
  });

  test('verify detects valid native HTTP config (Windsurf serverUrl field)', async () => {
    mkdirSync(join(testConfigDir, '.codeium', 'windsurf'), { recursive: true });
    const windsurf = windsurfPath(testConfigDir);
    writeFileSync(windsurf, JSON.stringify({
      mcpServers: {
        anima: {
          serverUrl: 'https://mcp.useanima.sh/mcp',
          headers: { Authorization: 'Bearer ${env:ANIMA_API_KEY}' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'windsurf',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; mode: string; issues: string[] }>;
    };
    expect(payload.results[0].status).toBe('ok');
    expect(payload.results[0].mode).toBe('remote');
  });

  test('status detects native HTTP config mode for Cursor', async () => {
    const cursor = cursorPath(testConfigDir);
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });
    writeFileSync(cursor, JSON.stringify({
      mcpServers: {
        anima: {
          url: 'https://mcp.useanima.sh/mcp',
          headers: { Authorization: 'Bearer ak_test_123' },
        },
      },
    }, null, 2));

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync(['node', 'anima', '--json', 'setup-mcp', 'status']);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      clients: Array<{ client: string; mode: string; url: string | null; configured: boolean }>;
    };
    const cursorRow = payload.clients.find((c) => c.client === 'Cursor');
    expect(cursorRow?.mode).toBe('remote');
    expect(cursorRow?.url).toBe('https://mcp.useanima.sh/mcp');
    expect(cursorRow?.configured).toBe(true);
  });

  test('verify errors on unconfigured client', async () => {
    mkdirSync(join(testConfigDir, '.cursor'), { recursive: true });

    const logSpy = mock(() => {});
    const originalLog = console.log;
    console.log = logSpy;

    await program.parseAsync([
      'node', 'anima', '--json', 'setup-mcp', 'verify', '--client', 'cursor',
    ]);

    console.log = originalLog;

    const payload = parseLastJsonLog(logSpy) as {
      results: Array<{ client: string; status: string; issues: string[] }>;
    };
    expect(payload.results[0].status).toBe('error');
    expect(payload.results[0].issues).toContain('not configured');
  });
});
