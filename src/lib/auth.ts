import { ApiClient, ApiError } from './api-client.js';
import { getAuthConfig } from './config.js';

export interface GlobalOptions {
  json?: boolean;
  debug?: boolean;
  token?: string;
  apiUrl?: string;
}

const DEFAULT_API_URL = 'http://localhost:4001';

export function resolveApiUrl(opts: GlobalOptions, authApiUrl?: string): string {
  return opts.apiUrl ?? process.env.ANIMA_API_URL ?? authApiUrl ?? DEFAULT_API_URL;
}

export async function getApiClient(opts: GlobalOptions): Promise<ApiClient> {
  const auth = await getAuthConfig();

  const token = opts.token ?? process.env.ANIMA_TOKEN ?? auth.token;
  const apiKey = process.env.ANIMA_API_KEY ?? auth.apiKey;

  const baseUrl = resolveApiUrl(opts, auth.apiUrl);

  return new ApiClient({
    baseUrl,
    token: token ?? undefined,
    apiKey: token ? undefined : apiKey,
    debug: opts.debug ?? false,
  });
}

export async function requireAuth(opts: GlobalOptions): Promise<ApiClient> {
  const auth = await getAuthConfig();

  const token = opts.token ?? process.env.ANIMA_TOKEN ?? auth.token;
  const apiKey = process.env.ANIMA_API_KEY ?? auth.apiKey;

  if (!token && !apiKey) {
    throw new ApiError(
      401,
      'NOT_AUTHENTICATED',
      'Not authenticated. Run `anima auth login` to authenticate.'
    );
  }

  if (token && auth.expiresAt && !opts.token && !process.env.ANIMA_TOKEN) {
    const expiresAt = new Date(auth.expiresAt);
    if (expiresAt < new Date()) {
      if (auth.refreshToken) {
        const baseUrl = resolveApiUrl(opts, auth.apiUrl);
        const refreshClient = new ApiClient({ baseUrl });
        try {
          const result = await refreshClient.post<{ token: string; refreshToken: string; expiresAt: string }>(
            '/api/v1/auth/refresh',
            { refreshToken: auth.refreshToken }
          );
          const { saveAuthConfig } = await import('./config.js');
          await saveAuthConfig({
            ...auth,
            token: result.token,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
          });
          return new ApiClient({
            baseUrl,
            token: result.token,
            debug: opts.debug ?? false,
          });
        } catch {
          throw new ApiError(
            401,
            'TOKEN_EXPIRED',
            'Session expired and refresh failed. Run `anima auth login` to re-authenticate.'
          );
        }
      }
      throw new ApiError(
        401,
        'TOKEN_EXPIRED',
        'Session expired. Run `anima auth login` to re-authenticate.'
      );
    }
  }

  return getApiClient(opts);
}
