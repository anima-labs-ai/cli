import { ApiClient, ApiError } from './api-client.js';
import { getAuthConfig } from './config.js';

export interface GlobalOptions {
  json?: boolean;
  human?: boolean;
  format?: 'agent' | 'human' | 'json' | 'yaml' | 'jsonl' | 'md';
  debug?: boolean;
  test?: boolean;
  token?: string;
  apiUrl?: string;
}

// Production API. Override via --api-url=http://localhost:4001 (or set
// ANIMA_API_URL) for local dev. Was 'http://localhost:4001' which leaked
// into the user-facing OAuth flow — when no auth config existed, the CLI
// would derive the connect URL from this and open the browser at
// http://localhost:3000 instead of https://connect.useanima.sh.
const DEFAULT_API_URL = 'https://api.useanima.sh';

export function resolveApiUrl(opts: GlobalOptions, authApiUrl?: string): string {
  return opts.apiUrl ?? process.env.ANIMA_API_URL ?? authApiUrl ?? DEFAULT_API_URL;
}

export async function getApiClient(opts: GlobalOptions): Promise<ApiClient> {
  const auth = await getAuthConfig();

  // Priority: CLI flags > explicit env vars > stored config
  // If ANIMA_API_KEY is explicitly set, it should override stored auth tokens.
  const explicitApiKey = process.env.ANIMA_API_KEY;
  const explicitToken = opts.token ?? process.env.ANIMA_TOKEN;

  // Use the explicit API key when set, even if a stored token exists
  const token = explicitApiKey ? undefined : (explicitToken ?? auth.token);
  const apiKey = explicitApiKey ?? auth.apiKey;

  const baseUrl = resolveApiUrl(opts, auth.apiUrl);

  return new ApiClient({
    baseUrl,
    token: token ?? undefined,
    apiKey: token ? undefined : apiKey,
    debug: opts.debug ?? false,
    testMode: opts.test ?? false,
  });
}

export async function requireAuth(opts: GlobalOptions): Promise<ApiClient> {
  const auth = await getAuthConfig();

  // Same priority logic as getApiClient: explicit env vars override stored config
  const explicitApiKey = process.env.ANIMA_API_KEY;
  const explicitToken = opts.token ?? process.env.ANIMA_TOKEN;
  const token = explicitApiKey ? undefined : (explicitToken ?? auth.token);
  const apiKey = explicitApiKey ?? auth.apiKey;

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
            testMode: opts.test ?? false,
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
