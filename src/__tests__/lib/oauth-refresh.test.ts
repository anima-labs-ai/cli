import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  OAuthRefreshError,
  isOAuthAccessToken,
  refreshOAuthToken,
} from '../../lib/oauth-refresh.js';

// We deliberately do NOT use the api-client test server — these tests
// exercise the raw `fetch` path that the refresh helper uses to break the
// chicken-and-egg loop with `ApiClient`.
const TEST_PORT = 19877;
const BASE_URL = `http://localhost:${TEST_PORT}`;

interface RouteResponse {
  status: number;
  body: unknown;
  bodyOverride?: string; // for malformed-JSON tests
}

const routes: Record<string, RouteResponse> = {};
let lastRequestBody: unknown = null;

function setRoute(path: string, response: RouteResponse): void {
  routes[path] = response;
}

function clearRoutes(): void {
  for (const k of Object.keys(routes)) delete routes[k];
  lastRequestBody = null;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  mockServer = Bun.serve({
    port: TEST_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) {
        return new Response(JSON.stringify({ message: 'no route' }), { status: 404 });
      }
      try {
        lastRequestBody = await req.json();
      } catch {
        lastRequestBody = null;
      }
      const body =
        route.bodyOverride !== undefined ? route.bodyOverride : JSON.stringify(route.body);
      return new Response(body, {
        status: route.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
});

afterAll(() => {
  mockServer?.stop();
});

describe('isOAuthAccessToken', () => {
  test('matches the oat_ prefix', () => {
    expect(isOAuthAccessToken('oat_abc123')).toBe(true);
  });

  test('rejects other credential types', () => {
    expect(isOAuthAccessToken('mk_abc')).toBe(false);
    expect(isOAuthAccessToken('ak_abc')).toBe(false);
    expect(isOAuthAccessToken('sk_abc')).toBe(false);
    expect(isOAuthAccessToken('stk_abc')).toBe(false);
    expect(isOAuthAccessToken('ort_abc')).toBe(false); // RT, not AT
  });

  test('handles empty / undefined / null safely', () => {
    expect(isOAuthAccessToken(undefined)).toBe(false);
    expect(isOAuthAccessToken(null)).toBe(false);
    expect(isOAuthAccessToken('')).toBe(false);
  });
});

describe('refreshOAuthToken', () => {
  test('returns rotated tokens and computed expiry timestamps on success', async () => {
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 200,
      body: {
        accessToken: 'oat_new_access',
        refreshToken: 'ort_new_refresh',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshTokenExpiresIn: 30 * 24 * 3600,
        scope: 'cards:read email:read',
      },
    });

    const before = Date.now();
    const result = await refreshOAuthToken(BASE_URL, 'ort_old_refresh');
    const after = Date.now();

    expect(result.accessToken).toBe('oat_new_access');
    expect(result.refreshToken).toBe('ort_new_refresh');
    expect(result.scope).toBe('cards:read email:read');

    const accessExpiry = Date.parse(result.expiresAt);
    expect(accessExpiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(accessExpiry).toBeLessThanOrEqual(after + 3600 * 1000);

    const refreshExpiry = Date.parse(result.refreshTokenExpiresAt);
    expect(refreshExpiry).toBeGreaterThanOrEqual(before + 30 * 24 * 3600 * 1000);
    expect(refreshExpiry).toBeLessThanOrEqual(after + 30 * 24 * 3600 * 1000);

    // Verify the request body uses the camelCase contract the API expects.
    expect(lastRequestBody).toEqual({
      grantType: 'refresh_token',
      refreshToken: 'ort_old_refresh',
    });
  });

  test('handles a trailing slash on the apiUrl', async () => {
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 200,
      body: {
        accessToken: 'oat_x',
        refreshToken: 'ort_y',
        tokenType: 'Bearer',
        expiresIn: 60,
        refreshTokenExpiresIn: 60,
        scope: '',
      },
    });
    const result = await refreshOAuthToken(`${BASE_URL}/`, 'ort_old');
    expect(result.accessToken).toBe('oat_x');
  });

  test('classifies 4xx with INVALID_GRANT as invalid_grant (RT is dead)', async () => {
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 400,
      body: {
        message: 'INVALID_GRANT — refresh token reuse detected; grant revoked. Re-authorize.',
        code: 'VALIDATION_ERROR',
      },
    });

    try {
      await refreshOAuthToken(BASE_URL, 'ort_replayed');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthRefreshError);
      const e = err as OAuthRefreshError;
      expect(e.kind).toBe('invalid_grant');
      expect(e.message).toContain('reuse detected');
    }
  });

  test('classifies any 4xx as invalid_grant — re-auth is the only recovery path', async () => {
    // Even if the server message doesn't include INVALID_GRANT verbatim, a
    // 4xx response means there's no point retrying with the same RT.
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 401,
      body: { message: 'unauthorized', code: 'UNAUTHORIZED' },
    });

    try {
      await refreshOAuthToken(BASE_URL, 'ort_x');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as OAuthRefreshError).kind).toBe('invalid_grant');
    }
  });

  test('classifies 5xx as server (transient — caller should retry, not wipe creds)', async () => {
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 503,
      body: { message: 'service unavailable' },
    });

    try {
      await refreshOAuthToken(BASE_URL, 'ort_x');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as OAuthRefreshError).kind).toBe('server');
    }
  });

  test('classifies network errors as network', async () => {
    // Hit a port that nothing's listening on.
    try {
      await refreshOAuthToken('http://127.0.0.1:1', 'ort_x');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthRefreshError);
      expect((err as OAuthRefreshError).kind).toBe('network');
    }
  });

  test('classifies 200 with malformed JSON as malformed', async () => {
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 200,
      body: null,
      bodyOverride: 'this is not json {{{',
    });

    try {
      await refreshOAuthToken(BASE_URL, 'ort_x');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as OAuthRefreshError).kind).toBe('malformed');
    }
  });

  test('classifies 200 missing accessToken/refreshToken as malformed', async () => {
    clearRoutes();
    setRoute('POST /v1/oauth/token', {
      status: 200,
      body: { scope: 'cards:read', expiresIn: 60, refreshTokenExpiresIn: 60 },
    });

    try {
      await refreshOAuthToken(BASE_URL, 'ort_x');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as OAuthRefreshError).kind).toBe('malformed');
    }
  });
});
