/**
 * OAuth 2.1 refresh-token grant — used when the access token (`oat_*`)
 * has expired and we still have a valid stored refresh token (`ort_*`).
 *
 * RFC 6749 §6 + RFC 6749 §10.4 (reuse detection). The Anima API enforces:
 *   • Single-use refresh tokens — every successful refresh rotates the RT
 *   • Reuse detection — replaying a consumed RT revokes the entire grant
 *     family (both legitimate client and attacker get kicked, by design)
 *   • No reuse grace window — racing refreshes mean one wins, the other
 *     gets `INVALID_GRANT` and must re-authorize
 *
 * Because of point 3, callers MUST single-flight refresh attempts. See
 * `ensureFreshOAuthToken` in `auth.ts` for the in-process locking.
 *
 * Implementation note: this code uses raw `fetch`, not `ApiClient.post`,
 * to avoid a chicken-and-egg loop (the client we'd construct is precisely
 * the one whose token we're trying to refresh).
 */

export const OAUTH_ACCESS_TOKEN_PREFIX = 'oat_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'ort_';

/**
 * True if `credential` looks like an Anima OAuth access token. The prefix
 * is the canonical signal — `mk_*`, `ak_*`, `sk_*`, etc. all bypass refresh
 * because they have no associated refresh token.
 */
export function isOAuthAccessToken(credential: string | undefined | null): boolean {
  return typeof credential === 'string' && credential.startsWith(OAUTH_ACCESS_TOKEN_PREFIX);
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 timestamp of access-token expiry. */
  expiresAt: string;
  /** ISO-8601 timestamp of refresh-token expiry (~30d from issuance). */
  refreshTokenExpiresAt: string;
  /** Space-separated scope string (verbatim from the server). */
  scope: string;
}

/**
 * Distinguishable failure kinds so callers can decide once whether to
 * wipe credentials (invalid_grant) vs. surface a transient error
 * (network / server) and let the user retry.
 */
export type OAuthRefreshErrorKind = 'invalid_grant' | 'network' | 'server' | 'malformed';

export class OAuthRefreshError extends Error {
  constructor(
    public readonly kind: OAuthRefreshErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OAuthRefreshError';
  }
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** Access-token TTL in seconds. */
  expiresIn: number;
  /** Refresh-token TTL in seconds. */
  refreshTokenExpiresIn: number;
  scope: string;
}

/**
 * Exchange a refresh token for a new (access, refresh) pair. The old RT
 * is consumed atomically by the server; the returned `refreshToken` is
 * the new one and MUST be persisted before this call returns to the
 * caller's caller (otherwise a crash here leaves the user with an RT
 * the server already revoked, forcing a manual re-login).
 *
 * Throws `OAuthRefreshError` on every non-2xx outcome:
 *   • `invalid_grant` — RT expired/revoked/reused/unknown. Wipe creds.
 *   • `network`       — couldn't reach the API. Don't wipe; let the user retry.
 *   • `server`        — 5xx. Same as above, transient.
 *   • `malformed`     — 200 with unparseable body. Treat as server error.
 */
export async function refreshOAuthToken(
  apiUrl: string,
  refreshToken: string,
): Promise<RefreshResult> {
  const url = `${apiUrl.replace(/\/$/, '')}/v1/oauth/token`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grantType: 'refresh_token',
        refreshToken,
      }),
    });
  } catch (err) {
    throw new OAuthRefreshError(
      'network',
      `Could not reach Anima API at ${apiUrl} to refresh session.`,
      err,
    );
  }

  if (!response.ok) {
    let body: { message?: string; code?: string } = {};
    try {
      body = (await response.json()) as { message?: string; code?: string };
    } catch {
      // non-JSON error response, fall through with empty body
    }
    const message = body.message ?? `Refresh failed (HTTP ${response.status})`;

    // 5xx is transient; 4xx is the server saying "this RT is dead, stop
    // asking". The API surfaces dead-RT cases as VALIDATION_ERROR whose
    // message begins `INVALID_GRANT — …`; we treat any 4xx as invalid_grant
    // because there's no recovery path that doesn't involve re-login.
    if (response.status >= 500) {
      throw new OAuthRefreshError('server', message);
    }
    throw new OAuthRefreshError('invalid_grant', message);
  }

  let tokens: TokenResponse;
  try {
    tokens = (await response.json()) as TokenResponse;
  } catch (err) {
    throw new OAuthRefreshError('malformed', 'Refresh response was not valid JSON', err);
  }

  if (!tokens.accessToken || !tokens.refreshToken) {
    throw new OAuthRefreshError('malformed', 'Refresh response missing accessToken or refreshToken');
  }

  const now = Date.now();
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(now + tokens.expiresIn * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + tokens.refreshTokenExpiresIn * 1000).toISOString(),
    scope: tokens.scope,
  };
}
