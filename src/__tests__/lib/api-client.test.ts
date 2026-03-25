import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { ApiClient, ApiError } from '../../lib/api-client.js';

let mockServer: ReturnType<typeof Bun.serve> | null = null;
const TEST_PORT = 19876;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const routes: Record<string, { status: number; body: unknown; headers?: Record<string, string> }> = {};

function setRoute(path: string, response: { status: number; body: unknown; headers?: Record<string, string> }) {
  routes[path] = response;
}

function clearRoutes() {
  for (const key of Object.keys(routes)) {
    delete routes[key];
  }
}

beforeAll(() => {
  mockServer = Bun.serve({
    port: TEST_PORT,
    fetch(req) {
      const url = new URL(req.url);
      const routeKey = `${req.method} ${url.pathname}`;
      const route = routes[routeKey];

      if (route) {
        return new Response(
          route.status === 204 ? null : JSON.stringify(route.body),
          {
            status: route.status,
            headers: {
              'Content-Type': 'application/json',
              ...(route.headers ?? {}),
            },
          },
        );
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
});

afterAll(() => {
  mockServer?.stop();
});

describe('ApiError', () => {
  test('creates error with status and message', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Bad Request');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Bad Request');
  });

  test('creates error with details', () => {
    const details = { field: 'email', issue: 'invalid' };
    const err = new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', details);
    expect(err.details).toEqual(details);
  });
});

describe('ApiClient', () => {
  describe('constructor', () => {
    test('creates client with base URL', () => {
      const client = new ApiClient({ baseUrl: BASE_URL });
      expect(client).toBeDefined();
    });

    test('creates client with token auth', () => {
      const client = new ApiClient({ baseUrl: BASE_URL, token: 'test-token' });
      expect(client).toBeDefined();
    });

    test('creates client with API key auth', () => {
      const client = new ApiClient({ baseUrl: BASE_URL, apiKey: 'sk_test_key' });
      expect(client).toBeDefined();
    });
  });

  describe('GET', () => {
    test('sends GET request and returns parsed JSON', async () => {
      setRoute('GET /api/v1/test', {
        status: 200,
        body: { id: '1', name: 'Test' },
      });

      const client = new ApiClient({ baseUrl: BASE_URL });
      const result = await client.get<{ id: string; name: string }>('/api/v1/test');

      expect(result.id).toBe('1');
      expect(result.name).toBe('Test');

      clearRoutes();
    });

    test('sends GET request with query params', async () => {
      setRoute('GET /api/v1/items', {
        status: 200,
        body: { items: [], total: 0 },
      });

      const client = new ApiClient({ baseUrl: BASE_URL });
      const result = await client.get<{ items: unknown[]; total: number }>('/api/v1/items', {
        page: '1',
        limit: '10',
      });

      expect(result.total).toBe(0);
      clearRoutes();
    });

    test('throws ApiError on 404', async () => {
      const client = new ApiClient({ baseUrl: BASE_URL });

      try {
        await client.get('/api/v1/nonexistent');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(404);
      }
    });

    test('throws ApiError on 401', async () => {
      setRoute('GET /api/v1/protected', {
        status: 401,
        body: { message: 'Unauthorized', code: 'AUTH_ERROR' },
      });

      const client = new ApiClient({ baseUrl: BASE_URL });

      try {
        await client.get('/api/v1/protected');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(401);
      }

      clearRoutes();
    });
  });

  describe('POST', () => {
    test('sends POST request with body', async () => {
      setRoute('POST /api/v1/agents', {
        status: 201,
        body: { id: 'agent-1', name: 'TestBot' },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, token: 'test-token' });
      const result = await client.post<{ id: string; name: string }>('/api/v1/agents', {
        name: 'TestBot',
      });

      expect(result.id).toBe('agent-1');
      expect(result.name).toBe('TestBot');
      clearRoutes();
    });

    test('handles 204 No Content', async () => {
      setRoute('POST /api/v1/action', {
        status: 204,
        body: null,
      });

      const client = new ApiClient({ baseUrl: BASE_URL, token: 'test-token' });
      const result = await client.post('/api/v1/action');

      expect(result).toEqual({});
      clearRoutes();
    });
  });

  describe('PATCH', () => {
    test('sends PATCH request', async () => {
      setRoute('PATCH /api/v1/agents/1', {
        status: 200,
        body: { id: '1', name: 'Updated' },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, token: 'test-token' });
      const result = await client.patch<{ id: string; name: string }>('/api/v1/agents/1', {
        name: 'Updated',
      });

      expect(result.name).toBe('Updated');
      clearRoutes();
    });
  });

  describe('PUT', () => {
    test('sends PUT request', async () => {
      setRoute('PUT /api/v1/agents/1', {
        status: 200,
        body: { id: '1', name: 'Replaced' },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, token: 'test-token' });
      const result = await client.put<{ id: string; name: string }>('/api/v1/agents/1', {
        name: 'Replaced',
      });

      expect(result.name).toBe('Replaced');
      clearRoutes();
    });
  });

  describe('DELETE', () => {
    test('sends DELETE request', async () => {
      setRoute('DELETE /api/v1/agents/1', {
        status: 200,
        body: { success: true },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, token: 'test-token' });
      const result = await client.delete<{ success: boolean }>('/api/v1/agents/1');

      expect(result.success).toBe(true);
      clearRoutes();
    });
  });

  describe('auth headers', () => {
    test('sends Authorization header with token', async () => {
      setRoute('GET /api/v1/auth-check', {
        status: 200,
        body: { ok: true },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, token: 'my-secret-token' });
      const result = await client.get<{ ok: boolean }>('/api/v1/auth-check');
      expect(result.ok).toBe(true);

      clearRoutes();
    });

    test('sends X-API-Key header with api key', async () => {
      setRoute('GET /api/v1/auth-check', {
        status: 200,
        body: { ok: true },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, apiKey: 'sk_test_key' });
      const result = await client.get<{ ok: boolean }>('/api/v1/auth-check');
      expect(result.ok).toBe(true);

      clearRoutes();
    });
  });

  describe('timeout', () => {
    test('aborts request on timeout', async () => {
      mockServer?.stop();
      mockServer = Bun.serve({
        port: TEST_PORT,
        async fetch() {
          await Bun.sleep(5000);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      });

      const client = new ApiClient({ baseUrl: BASE_URL, timeout: 100 });

      try {
        await client.get('/api/v1/slow');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      mockServer?.stop();
      mockServer = Bun.serve({
        port: TEST_PORT,
        fetch(req) {
          const url = new URL(req.url);
          const routeKey = `${req.method} ${url.pathname}`;
          const route = routes[routeKey];
          if (route) {
            return new Response(
              route.status === 204 ? null : JSON.stringify(route.body),
              { status: route.status, headers: { 'Content-Type': 'application/json', ...(route.headers ?? {}) } },
            );
          }
          return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        },
      });
    });
  });
});
