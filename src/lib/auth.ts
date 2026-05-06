import { ApiClient, ApiError } from './api-client.js';
import {
  type AuthConfig,
  getAuthConfig,
  saveAuthConfig,
} from './config.js';
import {
  isOAuthAccessToken,
  OAuthRefreshError,
  refreshOAuthToken,
} from './oauth-refresh.js';

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

// ── OAuth access-token auto-refresh ─────────────────────────────────────────
//
// The CLI's OAuth flow (`am auth login --web`) stores an `oat_*` access
// token (1h TTL) and an `ort_*` refresh token (30d TTL). Without auto-
// refresh, every command run more than 1h after login fails with 401 and
// the user has to re-authenticate. With auto-refresh, the access token is
// transparently rotated in the background and only a dead refresh token
// (revoked, reused, or genuinely 30+ days old) prompts re-login.
//
// Single-flight is critical: the API's reuse-detection logic revokes the
// entire grant family on RT replay, so two parallel commands trying to
// refresh with the same RT would lock the user out. The module-level
// `_refreshInFlight` promise ensures concurrent callers share one network
// round-trip.

const REFRESH_SKEW_MS = 30_000; // refresh 30s before strict expiry to avoid clock skew

let _refreshInFlight: Promise<AuthConfig> | null = null;

function isExpired(isoExpiresAt: string | undefined, skewMs = REFRESH_SKEW_MS): boolean {
  if (!isoExpiresAt) return false;
  const t = Date.parse(isoExpiresAt);
  if (Number.isNaN(t)) return false;
  return t <= Date.now() + skewMs;
}

/**
 * If the current credential is an OAuth access token that's expired (or
 * about to expire), perform a refresh-token grant and persist the new
 * (access, refresh) pair. Returns the up-to-date `AuthConfig`.
 *
 * Non-OAuth credentials (api keys, master keys, session tokens) pass
 * through unchanged — they have their own expiry/refresh paths handled
 * elsewhere or no expiry at all.
 *
 * On `invalid_grant` from the server, the local credential is wiped (the
 * RT is dead — keeping it around would just produce confusing 401s on the
 * next command). Network/server errors leave the stale config in place so
 * the caller can retry.
 */
async function ensureFreshOAuthToken(opts: GlobalOptions): Promise<AuthConfig> {
  const auth = await getAuthConfig();

  // Only the OAuth flow needs this. Anything else (API key, master key,
  // session token in `auth.token`) is handled by separate code paths.
  if (!isOAuthAccessToken(auth.apiKey)) return auth;
  if (!auth.refreshToken) return auth;        // no RT → nothing we can do, let API 401
  if (!isExpired(auth.expiresAt)) return auth; // still fresh

  // Cheap proactive check: if even the RT is past its stored expiry, skip
  // the network call and surface re-login immediately. Saves a round-trip
  // for users who left the CLI idle for 30+ days.
  if (auth.refreshTokenExpiresAt && isExpired(auth.refreshTokenExpiresAt, 0)) {
    await saveAuthConfig({ apiUrl: auth.apiUrl });
    throw new ApiError(
      401,
      'SESSION_EXPIRED',
      'Your Anima session expired. Run `am auth login` to sign in again.',
    );
  }

  // Single-flight: only one refresh in flight per process. Concurrent
  // callers await the same promise. This MUST hold globally — see
  // reuse-detection note above.
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    try {
      const apiUrl = resolveApiUrl(opts, auth.apiUrl);
      const result = await refreshOAuthToken(apiUrl, auth.refreshToken!);
      const updated: AuthConfig = {
        ...auth,
        apiKey: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt,
      };
      await saveAuthConfig(updated);
      return updated;
    } catch (err) {
      if (err instanceof OAuthRefreshError && err.kind === 'invalid_grant') {
        // RT is dead (revoked / reused / expired / unknown). Wipe creds so
        // the next command's 'not authenticated' message is clean. Preserve
        // apiUrl so the user doesn't have to re-specify it on next login.
        await saveAuthConfig({ apiUrl: auth.apiUrl });
        throw new ApiError(
          401,
          'SESSION_EXPIRED',
          'Your Anima session expired. Run `am auth login` to sign in again.',
        );
      }
      // Network or 5xx — keep stale config, let the caller retry. The 401
      // they may get from the API will be handled by individual commands.
      throw err;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

export async function getApiClient(opts: GlobalOptions): Promise<ApiClient> {
  const auth = await ensureFreshOAuthToken(opts);

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
  const auth = await ensureFreshOAuthToken(opts);

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

// ── Header resolution for the typed oRPC client ─────────────────────────────
//
// The legacy `requireAuth` constructs an `ApiClient` with the token baked
// into a static header bag. The oRPC link instead asks for headers per
// request via an async callback — this lets us honor token rotation
// (`ensureFreshOAuthToken`) between successive calls in the same process
// without rebuilding the client. `ensureAuthHeaders` is the bridge.
//
// Pass `{ requireToken: true }` to mirror `requireAuth`'s eager check —
// surfaces the "not authenticated" error before the first network call
// instead of letting the server return a confusing 401.

export async function ensureAuthHeaders(
  opts: GlobalOptions,
  { requireToken = false }: { requireToken?: boolean } = {},
): Promise<Record<string, string>> {
  const auth = await ensureFreshOAuthToken(opts);

  const explicitApiKey = process.env.ANIMA_API_KEY;
  const explicitToken = opts.token ?? process.env.ANIMA_TOKEN;
  const token = explicitApiKey ? undefined : (explicitToken ?? auth.token);
  const apiKey = explicitApiKey ?? auth.apiKey;

  if (requireToken && !token && !apiKey) {
    throw new ApiError(
      401,
      'NOT_AUTHENTICATED',
      'Not authenticated. Run `anima auth login` to authenticate.',
    );
  }

  const credential = token ?? apiKey;
  const headers: Record<string, string> = {};
  if (credential) {
    headers.Authorization = `Bearer ${credential}`;
  }
  if (opts.test) {
    headers['X-Anima-Test-Mode'] = '1';
  }
  return headers;
}
