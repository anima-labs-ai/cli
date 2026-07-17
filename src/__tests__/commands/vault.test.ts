import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { resetPathsCache, setPathsOverride } from '../../lib/config.js';
import type { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testConfigDir = join(import.meta.dir, '.test-vault-config');

mock.module('env-paths', () => ({
  default: () => ({
    config: testConfigDir,
    data: testConfigDir,
    cache: testConfigDir,
    log: testConfigDir,
    temp: testConfigDir,
  }),
}));

const { createProgram } = await import('../../cli.js');

// Real-looking CUIDs so the contract's z.string().cuid() input validation
// in the typed oRPC client doesn't reject the test args before the request
// ever hits the mock server.
const AGENT_ID_1 = 'caaa00000000000000000agt01';
const AGENT_ID_2 = 'caaa00000000000000000agt02';
const CRED_ID_1 = 'caaa00000000000000000crd01';
const CRED_ID_2 = 'caaa00000000000000000crd02';
const SHARE_ID_1 = 'caaa00000000000000000shr01';
const VAULT_ID_1 = 'caaa00000000000000000vlt01';
const ORG_ID_1 = 'caaa00000000000000000org01';

interface RouteResponse {
  status: number;
  body: unknown;
  assert?: (ctx: { url: URL; body: unknown }) => void;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let program: Command;
const routes: Record<string, RouteResponse> = {};

function setRoute(method: string, path: string, route: RouteResponse): void {
  routes[`${method} ${path}`] = route;
}

function clearRoutes(): void {
  for (const key of Object.keys(routes)) {
    delete routes[key];
  }
}

function writeAuthConfig(port: number): void {
  const authPath = join(testConfigDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({ token: 'test-token', apiUrl: `http://localhost:${port}` }));
}

async function runProgram(args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'anima', ...args]);
  } catch {
  }
}

// Build a complete CredentialOutputSchema-shaped response. Required because
// oRPC contracts derive the output type from a Zod schema; partial mock
// responses lead to undefined fields when commands access typed fields.
function buildCredentialResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: CRED_ID_1,
    type: 'login',
    name: 'GitHub',
    login: {
      username: 'octocat',
      password: '****',
      uris: [{ uri: 'https://github.com' }],
    },
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Build a complete ProvisionVaultOutput-shaped response.
function buildProvisionResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: VAULT_ID_1,
    agentId: AGENT_ID_1,
    orgId: ORG_ID_1,
    vaultUserId: 'user_1',
    vaultOrgId: 'vorg_1',
    collectionId: 'col_1',
    status: 'ACTIVE',
    credentialCount: 0,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Build a complete CredentialShareOutput-shaped response.
function buildShareResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SHARE_ID_1,
    credentialId: CRED_ID_1,
    orgId: ORG_ID_1,
    sourceAgentId: AGENT_ID_1,
    targetAgentId: AGENT_ID_2,
    permission: 'READ',
    expiresAt: null,
    grantedBy: AGENT_ID_1,
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('vault commands', () => {
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
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const key = `${req.method} ${url.pathname}`;
        const route = routes[key];

        if (process.env.ANIMA_TEST_DEBUG) {
          console.error(`[mock-server] ${req.method} ${url.pathname}${url.search}`);
        }

        if (!route) {
          return new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }

        let body: unknown = undefined;
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          const bodyText = await req.text();
          const contentType = req.headers.get('content-type') ?? '';
          if (bodyText && contentType.includes('application/json')) {
            body = JSON.parse(bodyText) as unknown;
          }
        }

        route.assert?.({ url, body });

        return new Response(
          route.status === 204 ? null : JSON.stringify(route.body),
          { status: route.status, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    mockServer = server;
    serverPort = server.port ?? 0;

    writeAuthConfig(serverPort);
  });

  afterEach(() => {
    mockServer?.stop();
    mockServer = null;
    clearRoutes();
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  test('vault provision sends expected body', async () => {
    setRoute('POST', '/v1/vault/provision', {
      status: 200,
      body: buildProvisionResponse(),
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: AGENT_ID_1 });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['vault', 'provision', '--agent', AGENT_ID_1]);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault deprovision sends expected body', async () => {
    setRoute('POST', '/v1/vault/deprovision', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: AGENT_ID_1 });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['vault', 'deprovision', '--agent', AGENT_ID_1]);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault status sends expected query and supports json', async () => {
    setRoute('GET', '/v1/vault/status', {
      status: 200,
      body: {
        serverUrl: 'http://localhost:8222',
        lastSync: '2026-01-01T00:00:00.000Z',
        status: 'unlocked',
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'vault', 'status', '--agent', AGENT_ID_1]);

    console.log = originalLog;

    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { status: string };
    expect(parsed.status).toBe('unlocked');
  });

  test('vault sync sends expected body', async () => {
    setRoute('POST', '/v1/vault/sync', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toEqual({ agentId: AGENT_ID_1 });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['vault', 'sync', '--agent', AGENT_ID_1]);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault store login sends expected body', async () => {
    setRoute('POST', '/v1/vault/credentials', {
      status: 200,
      body: buildCredentialResponse({
        login: {
          username: 'octocat',
          password: 'secret',
          uris: [{ uri: 'https://github.com' }],
        },
      }),
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          type: 'login',
          name: 'GitHub',
          login: {
            username: 'octocat',
            password: 'secret',
            uris: [{ uri: 'https://github.com' }],
          },
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault',
      'store',
      '--agent', AGENT_ID_1,
      '--type', 'login',
      '--name', 'GitHub',
      '--username', 'octocat',
      '--password', 'secret',
      '--uri', 'https://github.com',
    ]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { id: string };
    expect(parsed.id).toBe(CRED_ID_1);
  });

  test('vault store --generate-password sends generatePassword and no password', async () => {
    setRoute('POST', '/v1/vault/credentials', {
      status: 200,
      body: buildCredentialResponse({
        login: { username: 'bot@acme.io', password: '****' },
      }),
      assert: ({ body }) => {
        const payload = body as {
          generatePassword?: Record<string, unknown>;
          login?: { password?: string };
        };
        expect(payload.generatePassword).toEqual({ length: 32, special: false });
        // The CLI must never send a password alongside generation.
        expect(payload.login?.password).toBeUndefined();
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault',
      'store',
      '--agent', AGENT_ID_1,
      '--type', 'login',
      '--name', 'Acme Portal',
      '--username', 'bot@acme.io',
      '--generate-password',
      '--length', '32',
      '--no-special',
    ]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { id: string };
    expect(parsed.id).toBe(CRED_ID_1);
  });

  test('vault store --generate-password alone sends empty options (server defaults)', async () => {
    setRoute('POST', '/v1/vault/credentials', {
      status: 200,
      body: buildCredentialResponse({ login: { username: 'bot@acme.io', password: '****' } }),
      assert: ({ body }) => {
        expect((body as { generatePassword?: unknown }).generatePassword).toEqual({});
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault',
      'store',
      '--agent', AGENT_ID_1,
      '--name', 'Acme Portal',
      '--username', 'bot@acme.io',
      '--generate-password',
    ]);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault store rejects --password combined with --generate-password', async () => {
    let apiCalled = false;
    setRoute('POST', '/v1/vault/credentials', {
      status: 200,
      body: buildCredentialResponse(),
      assert: () => {
        apiCalled = true;
      },
    });

    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram([
      'vault',
      'store',
      '--agent', AGENT_ID_1,
      '--name', 'Conflicting',
      '--password', 'hunter2',
      '--generate-password',
    ]);

    console.error = originalError;
    exitSpy.mockRestore();

    expect(apiCalled).toBe(false);
    const message = String(errorSpy.mock.calls.at(0)?.at(0) ?? '');
    expect(message).toContain('mutually exclusive');
  });

  test('vault get fetches credential by id with agent query', async () => {
    setRoute('GET', `/v1/vault/credentials/${CRED_ID_1}`, {
      status: 200,
      body: buildCredentialResponse(),
      assert: ({ url }) => {
        // oRPC OpenAPILink lifts the `id` path param into the URL
        // (GET /vault/credentials/<id>) and puts other inputs in the
        // query string.
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['--json', 'vault', 'get', CRED_ID_1, '--agent', AGENT_ID_1]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { id: string };
    expect(parsed.id).toBe(CRED_ID_1);
  });

  test('vault get masks sensitive fields and never requests reveal', async () => {
    setRoute('GET', `/v1/vault/credentials/${CRED_ID_1}`, {
      status: 200,
      body: buildCredentialResponse({
        login: { username: 'octocat', password: 'plaintext-secret' },
      }),
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
        // The CLI can no longer reveal plaintext: it must never send reveal=true.
        expect(url.searchParams.get('reveal')).not.toBe('true');
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault',
      'get', CRED_ID_1,
      '--agent', AGENT_ID_1,
    ]);

    console.log = originalLog;
    const outputs = logSpy.mock.calls.map((call) => String(call.at(0) ?? ''));
    const credentialPayload = outputs
      .map((s) => {
        try { return JSON.parse(s); } catch { return null; }
      })
      .find(
        (v): v is { id: string; login: { password: string } } =>
          v !== null && typeof v === 'object' && 'login' in v,
      );
    // Even if the server returned plaintext, the CLI must mask it before printing.
    expect(credentialPayload?.login.password).toBe('****');
  });

  test('vault list calls credentials endpoint and renders output', async () => {
    setRoute('GET', '/v1/vault/credentials', {
      status: 200,
      body: {
        items: [buildCredentialResponse({ favorite: true })],
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['vault', 'list', '--agent', AGENT_ID_1]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(CRED_ID_1)).toBe(true);
  });

  test('vault search calls search endpoint with filters', async () => {
    setRoute('GET', '/v1/vault/search', {
      status: 200,
      body: {
        items: [
          buildCredentialResponse({
            id: CRED_ID_2,
            name: 'GitHub Account',
          }),
        ],
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
        expect(url.searchParams.get('search')).toBe('github');
        expect(url.searchParams.get('type')).toBe('login');
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'vault', 'search',
      '--agent', AGENT_ID_1,
      '--query', 'github',
      '--type', 'login',
    ]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(CRED_ID_2)).toBe(true);
  });

  test('vault delete calls delete endpoint with id in URL path', async () => {
    setRoute('DELETE', `/v1/vault/credentials/${CRED_ID_1}`, {
      status: 200,
      body: { success: true },
      // OpenAPILink lifts `id` into the URL path. Other inputs (like
      // `agentId`) are sent in either the query string or request body
      // depending on the link's serialization; the server accepts both,
      // so the test only verifies the URL path here.
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['vault', 'delete', CRED_ID_1, '--agent', AGENT_ID_1]);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault generate sends requested options and prints password', async () => {
    setRoute('POST', '/v1/vault/generate-password', {
      status: 200,
      body: { password: 'xK9!mP2@nL5#' },
      assert: ({ body }) => {
        expect(body).toEqual({
          agentId: AGENT_ID_1,
          length: 16,
          uppercase: true,
          lowercase: true,
          number: true,
          special: true,
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'vault', 'generate',
      '--agent', AGENT_ID_1,
      '--length', '16',
      '--uppercase',
      '--lowercase',
      '--numbers',
      '--special',
    ]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('xK9!mP2@nL5#')).toBe(true);
  });

  test('vault totp fetches code and period', async () => {
    setRoute('GET', `/v1/vault/totp/${CRED_ID_1}`, {
      status: 200,
      body: { code: '123456', period: 30 },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram(['vault', 'totp', CRED_ID_1, '--agent', AGENT_ID_1]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('123456')).toBe(true);
    expect(output.includes('30')).toBe(true);
  });

  test('vault share create sends sourceAgentId per renamed contract field', async () => {
    setRoute('POST', '/v1/vault/share', {
      status: 200,
      body: buildShareResponse({ permission: 'USE' }),
      assert: ({ body }) => {
        // Contract renamed `agentId` -> `sourceAgentId` in b4334def. The CLI
        // flag stays `--agent` for ergonomics; verify the wire body uses
        // the new name.
        expect(body).toMatchObject({
          credentialId: CRED_ID_1,
          sourceAgentId: AGENT_ID_1,
          targetAgentId: AGENT_ID_2,
          permission: 'USE',
          expiresInSeconds: 3600,
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault', 'share', 'create',
      '--agent', AGENT_ID_1,
      '--credential', CRED_ID_1,
      '--target', AGENT_ID_2,
      '--permission', 'USE',
      '--ttl', '3600',
    ]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as {
      sourceAgentId: string;
      permission: string;
    };
    expect(parsed.sourceAgentId).toBe(AGENT_ID_1);
    expect(parsed.permission).toBe('USE');
  });

  test('vault share list fetches shares with direction filter', async () => {
    setRoute('GET', '/v1/vault/shares', {
      status: 200,
      body: {
        items: [buildShareResponse()],
        pagination: { nextCursor: null, hasMore: false },
      },
      assert: ({ url }) => {
        expect(url.searchParams.get('agentId')).toBe(AGENT_ID_1);
        expect(url.searchParams.get('direction')).toBe('granted');
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'vault', 'share', 'list',
      '--agent', AGENT_ID_1,
      '--direction', 'granted',
    ]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes(SHARE_ID_1)).toBe(true);
  });

  test('vault share revoke posts share id', async () => {
    setRoute('POST', '/v1/vault/share/revoke', {
      status: 200,
      body: { success: true },
      assert: ({ body }) => {
        expect(body).toEqual({
          shareId: SHARE_ID_1,
          agentId: AGENT_ID_1,
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'vault', 'share', 'revoke',
      '--id', SHARE_ID_1,
      '--agent', AGENT_ID_1,
    ]);

    console.log = originalLog;
    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault token create posts credential and ttl', async () => {
    setRoute('POST', '/v1/vault/token', {
      status: 200,
      body: {
        token: 'vtk_' + 'a'.repeat(64),
        credentialId: CRED_ID_1,
        scope: 'autofill',
        expiresAt: '2026-01-01T00:01:00.000Z',
      },
      assert: ({ body }) => {
        expect(body).toMatchObject({
          agentId: AGENT_ID_1,
          credentialId: CRED_ID_1,
          scope: 'autofill',
          ttlSeconds: 120,
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault', 'token', 'create',
      '--agent', AGENT_ID_1,
      '--credential', CRED_ID_1,
      '--scope', 'autofill',
      '--ttl', '120',
    ]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as {
      token: string;
      scope: string;
    };
    expect(parsed.token.startsWith('vtk_')).toBe(true);
    expect(parsed.scope).toBe('autofill');
  });

  test('vault token exchange returns credential by token', async () => {
    setRoute('POST', '/v1/vault/token/exchange', {
      status: 200,
      body: buildCredentialResponse(),
      assert: ({ body }) => {
        expect(body).toEqual({ token: 'vtk_aabbccdd' });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      '--json',
      'vault', 'token', 'exchange',
      '--vtk', 'vtk_aabbccdd',
    ]);

    console.log = originalLog;
    const parsed = JSON.parse(String(logSpy.mock.calls.at(0)?.at(0) ?? '{}')) as { id: string };
    expect(parsed.id).toBe(CRED_ID_1);
  });

  test('vault token revoke posts agentId + credentialId and reports count', async () => {
    setRoute('POST', '/v1/vault/token/revoke', {
      status: 200,
      body: { success: true, revoked: 3 },
      assert: ({ body }) => {
        expect(body).toEqual({
          agentId: AGENT_ID_1,
          credentialId: CRED_ID_1,
        });
      },
    });

    const logSpy = mock((...args: unknown[]) => {});
    const originalLog = console.log;
    console.log = logSpy;

    await runProgram([
      'vault', 'token', 'revoke',
      '--agent', AGENT_ID_1,
      '--credential', CRED_ID_1,
    ]);

    console.log = originalLog;
    const output = logSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output.includes('Revoked 3 token(s)')).toBe(true);
  });

  test('vault commands handle ORPCError with friendly message', async () => {
    setRoute('POST', '/v1/vault/provision', {
      status: 400,
      body: {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid agent',
        },
      },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['vault', 'provision', '--agent', AGENT_ID_1]);

    console.error = originalError;
    process.exit = originalExit;

    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output).toContain('Failed to provision vault: Invalid agent');
  });

  test('vault list handles 429 rate limiting', async () => {
    setRoute('GET', '/v1/vault/credentials', {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['vault', 'list', '--agent', AGENT_ID_1]);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output).toContain('Failed to list credentials: Too many requests');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault get handles 404 with friendly message', async () => {
    setRoute('GET', `/v1/vault/credentials/${CRED_ID_1}`, {
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: 'Credential not found',
        },
      },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram(['vault', 'get', CRED_ID_1, '--agent', AGENT_ID_1]);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output).toContain('Credential not found');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test('vault get handles 403 forbidden with friendly message', async () => {
    setRoute('GET', `/v1/vault/credentials/${CRED_ID_1}`, {
      status: 403,
      body: {
        error: {
          code: 'FORBIDDEN',
          message: 'forbidden',
        },
      },
    });

    const exitSpy = mock((...args: unknown[]) => {});
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;

    const errorSpy = mock((...args: unknown[]) => {});
    const originalError = console.error;
    console.error = errorSpy;

    await runProgram([
      'vault', 'get', CRED_ID_1,
      '--agent', AGENT_ID_1,
    ]);

    console.error = originalError;
    process.exit = originalExit;

    const output = errorSpy.mock.calls.map((call) => String(call.at(0))).join('\n');
    expect(output).toContain('Forbidden');
    expect(exitSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
