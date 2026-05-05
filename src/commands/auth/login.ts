import { Command } from 'commander';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApiClient, ApiError } from '../../lib/api-client.js';
import { saveAuthConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import { type GlobalOptions, resolveApiUrl } from '../../lib/auth.js';

interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresAt: string;
  email: string;
}

interface LoginOptions {
  email?: string;
  password?: string;
  apiKey?: string;
  web?: boolean;
}

// OAuth client_id registered for the CLI in anima_oauth_apps.
const CLI_CLIENT_ID = 'anima-cli';

// Loopback redirect — RFC 8252 §7.3 native-app pattern. The OAuth server
// must have this exact URI in the app's `redirect_uris`.
const LOOPBACK_PORT = 8765;
const LOOPBACK_REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/callback`;

// Default scopes the CLI requests. Match the canonical Anima Connect
// scope vocabulary (lowercase colon-notation, Stripe/GitHub style).
// Definitive list: apps/web/src/lib/oauth/scopes.ts (ANIMA_SCOPES).
//
// Conservative defaults — read across the main domains, send for
// channels the CLI typically operates on (email + SMS), spend approval
// for cards (per-request — auto-approve is opt-in via a future flag).
// Users can refine via `am auth login --scopes=cards:read,email:read`
// (when that lands).
const DEFAULT_CLI_SCOPES = [
  'cards:read',
  'cards:spend',
  'email:read',
  'email:send_as',
  'phone:read_sms',
  'phone:send_sms',
  'vault:read_all',
  'addresses:read',
  'webhooks:subscribe',
];

export function loginCommand(): Command {
  return new Command('login')
    .description('Authenticate with Anima — browser-based OAuth by default; pass --api-key for non-interactive use')
    .option('-e, --email <email>', 'Email address (with --password for credentials flow)')
    .option('-p, --password <password>', 'Password (with --email)')
    .option('-k, --api-key <key>', 'API key — primary path for agents, scripts, CI')
    .option('--web', 'Force browser-based OAuth flow (default in interactive shells)')
    .option('--no-web', 'Disable browser auto-detect; require an explicit credential flag')
    .action(async function (this: Command) {
      const opts = this.opts<LoginOptions>();
      const globals = this.optsWithGlobals<LoginOptions & GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        // Explicit credential flags take precedence over auto-detect.
        if (opts.apiKey) {
          await loginWithApiKey(opts.apiKey, globals, output);
          return;
        }
        if (opts.email && opts.password) {
          await loginWithCredentials(opts.email, opts.password, globals, output);
          return;
        }

        // Auto-detect: in an interactive shell (TTY), default to browser
        // OAuth — that's the lowest-friction UX for humans setting up the
        // CLI on a workstation. In a non-TTY environment (CI, containers,
        // scripts) we fail-loud with a hint to pass --api-key, since
        // there's no way to drive the browser flow without a human.
        // `--web` forces the browser path explicitly; `--no-web` opts out.
        const wantBrowser = opts.web === true;
        const optedOutOfBrowser = opts.web === false;
        const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY);

        if (wantBrowser || (isInteractive && !optedOutOfBrowser)) {
          await loginWithBrowser(globals, output);
          return;
        }

        // No flag, non-interactive environment — fail with actionable text.
        // Short message for the agent format (low-token, code-friendly);
        // verbose multi-line for humans who want to see all options.
        const isHumanFormat =
          (globals.format ?? (globals.human ? 'human' : null)) === 'human' ||
          (process.stdout.isTTY && !globals.format && !globals.json);

        if (isHumanFormat) {
          output.error(
            'Non-interactive environment detected. Pass one of:\n' +
              '  --api-key=mk_xxx          (recommended for agents, scripts, CI)\n' +
              '  --email=... --password=... (credentials flow)\n' +
              '  --web                      (force browser-based OAuth — needs a TTY + display)\n' +
              '\n' +
              'Run with a TTY for the default browser-based flow.',
          );
        } else {
          // Compact: agent parses `code` to branch, ignores `hint`.
          output.payload({
            status: 'error',
            code: 'NO_AUTH_FLAG',
            message: 'Pass --api-key, --email/--password, or --web',
            hint: 'Default browser flow requires an interactive TTY',
          });
        }
        process.exit(1);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Login failed: ${error.message} (${error.status})`);
        } else if (error instanceof Error) {
          output.error(`Login failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

/**
 * Browser-based OAuth 2.1 + PKCE login (RFC 8252 native-app pattern).
 *
 * Flow:
 *   1. Generate PKCE verifier + S256 challenge
 *   2. Start a tiny HTTP server on http://localhost:8765/callback
 *   3. Open the user's default browser to connect.useanima.sh/authorize
 *   4. User signs in via Clerk + clicks Allow
 *   5. Browser redirects to localhost with ?code=...
 *   6. CLI captures code, exchanges at /api/oauth/token, stores oat_*
 *
 * Same UX as `gh auth login --web`, `stripe login`, `vercel login`.
 *
 * Loopback addresses are exempt from PKCE-only public-client restrictions
 * per RFC 8252 — the localhost listener proves the CLI is the entity that
 * initiated the flow.
 */
async function loginWithBrowser(globals: GlobalOptions, output: Output): Promise<void> {
  const apiUrl = resolveApiUrl(globals);

  // PKCE: random 32 bytes → base64url verifier; SHA-256 → base64url challenge.
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  // The /authorize URL we'll open. Anima Connect lives at connect.useanima.sh
  // in production. For dev/local, agents pass --api-url and we mirror that
  // host onto the connect subdomain via a heuristic.
  const connectBase = resolveConnectBase(apiUrl);
  const authorizeUrl = new URL(`${connectBase}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', CLI_CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', LOOPBACK_REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', DEFAULT_CLI_SCOPES.join(' '));
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  output.info('Starting OAuth 2.1 PKCE flow...');
  output.info(`Listening for callback on http://localhost:${LOOPBACK_PORT}/callback`);

  // Start the local HTTP server BEFORE opening the browser, otherwise the
  // browser might race ahead and hit a closed port.
  const codePromise = waitForOAuthCallback(state);

  output.info('Opening browser to:');
  output.info(`  ${authorizeUrl.toString()}`);
  await openInBrowser(authorizeUrl.toString());

  output.info('Waiting for you to approve in the browser...');
  const { code } = await codePromise;
  output.info('Got authorization code, exchanging for access token...');

  // Token exchange — POST to /api/oauth/token (web proxy that forwards to
  // /v1/oauth/token on the API). Public endpoint; PKCE verifier is the auth.
  const tokenUrl = `${apiUrl}/v1/oauth/token`;
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'authorization_code',
      code,
      redirectUri: LOOPBACK_REDIRECT_URI,
      clientId: CLI_CLIENT_ID,
      codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = (await tokenRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `Token exchange failed (${tokenRes.status}): ${errBody.message ?? 'unknown error'}`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    refreshTokenExpiresIn?: number;
    scope: string;
  };

  // Persist. The access token goes into `apiKey` so the existing API
  // middleware picks it up via the same Bearer auth path; `oat_*` prefix
  // is recognised by the API's auth resolver as an OAuth access token.
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  await saveAuthConfig({
    apiKey: tokens.accessToken,
    apiUrl,
    refreshToken: tokens.refreshToken,
    expiresAt,
    email: 'oauth-user', // userinfo will overwrite this
  });

  // Surface the user's identity from /v1/oauth/userinfo so the success
  // line shows who actually logged in.
  try {
    const client = new ApiClient({ baseUrl: apiUrl, apiKey: tokens.accessToken, debug: globals.debug });
    const me = await client.get<{ sub: string; email: string | null; anima: { orgName: string | null } }>(
      '/v1/oauth/userinfo',
    );
    const display = me.email ?? me.sub;
    const org = me.anima.orgName ?? '(no org)';
    output.success(`Logged in via Anima Connect as ${display} (org: ${org})`);
  } catch {
    output.success(`Logged in via Anima Connect (${tokens.scope.split(' ').length} scopes granted)`);
  }
}

/**
 * Resolve the Anima Connect base URL.
 *
 * Priority:
 *   1. ANIMA_CONNECT_URL env var (explicit override — dev / staging / preview)
 *   2. Match production: any *.useanima.sh API host → connect.useanima.sh
 *   3. localhost API host → localhost:3000 (local dev only)
 *   4. Fallback: https://connect.useanima.sh (production default)
 *
 * The fallback used to derive from the API URL, which silently produced
 * http://localhost:3000 when DEFAULT_API_URL was http://localhost:4001 —
 * leaking the dev URL into production user flows. Now production-default
 * is the explicit fallback; localhost-derivation requires an explicit
 * localhost API URL (which means the user has either passed --api-url or
 * set ANIMA_API_URL).
 */
function resolveConnectBase(apiUrl: string): string {
  // Explicit override always wins.
  if (process.env.ANIMA_CONNECT_URL) return process.env.ANIMA_CONNECT_URL;

  try {
    const url = new URL(apiUrl);
    if (url.hostname.endsWith('.useanima.sh') || url.hostname === 'useanima.sh') {
      return 'https://connect.useanima.sh';
    }
    // Localhost dev — only triggers when the user has *explicitly* pointed
    // the API at localhost. Default API URL is now production, so this
    // branch is reachable via --api-url=http://localhost:4001 or
    // ANIMA_API_URL=http://localhost:4001.
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return `${url.protocol}//${url.hostname}:3000`;
    }
  } catch {
    // Malformed apiUrl — fall through to production default.
  }
  // Custom host (staging / preview / unknown) → production connect by default.
  // Override via ANIMA_CONNECT_URL when running against a non-prod env.
  return 'https://connect.useanima.sh';
}

/**
 * Listen on the loopback port for the OAuth redirect, capture the code,
 * verify state, return the code. Closes the server after one request.
 *
 * Times out after 5 minutes — the user has plenty of time to sign in but
 * we don't want a forgotten flow to leak the port forever.
 */
function waitForOAuthCallback(expectedState: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost:${LOOPBACK_PORT}`);
      if (url.pathname !== '/callback') {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      // Render a small HTML page so the user knows the flow worked + can
      // close the tab. Same UX every CLI uses — gh, stripe, vercel etc.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (error) {
        res.statusCode = 400;
        res.end(renderResultPage('error', `Authorization denied: ${error}`));
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || !state) {
        res.statusCode = 400;
        res.end(renderResultPage('error', 'Missing code or state in callback'));
        server.close();
        reject(new Error('Missing code or state'));
        return;
      }

      if (state !== expectedState) {
        res.statusCode = 400;
        res.end(renderResultPage('error', 'State mismatch — possible CSRF'));
        server.close();
        reject(new Error('State mismatch'));
        return;
      }

      res.statusCode = 200;
      res.end(renderResultPage('ok', 'You can close this tab and return to the terminal.'));
      server.close();
      resolve({ code });
    });

    server.listen(LOOPBACK_PORT, '127.0.0.1', () => {
      // Server's up — caller will open the browser next.
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${LOOPBACK_PORT} is already in use. Close the process on that port and retry.`,
          ),
        );
        return;
      }
      reject(err);
    });

    // 5-min timeout.
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timed out after 5 minutes'));
    }, 5 * 60 * 1000).unref();
  });
}

function renderResultPage(kind: 'ok' | 'error', message: string): string {
  const color = kind === 'ok' ? '#10b981' : '#ef4444';
  const icon = kind === 'ok' ? '✓' : '✗';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Anima CLI · ${kind === 'ok' ? 'Signed in' : 'Error'}</title>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { padding: 48px; background: #171717; border: 1px solid #262626; border-radius: 8px; max-width: 480px; text-align: center; }
  .icon { width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 50%; background: ${color}; color: #0a0a0a; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: bold; }
  h1 { margin: 0 0 12px; font-size: 24px; }
  p { margin: 0; color: #a3a3a3; line-height: 1.5; }
</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1>${kind === 'ok' ? 'Signed in to Anima' : 'Sign-in failed'}</h1><p>${message}</p></div></body></html>`;
}

/**
 * Open a URL in the user's default browser. Cross-platform — uses the
 * native open command on each OS.
 */
async function openInBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  // Detached so the CLI doesn't wait for the browser process.
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function loginWithApiKey(
  apiKey: string,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const apiUrl = resolveApiUrl(globals);
  const client = new ApiClient({
    baseUrl: apiUrl,
    apiKey,
    debug: globals.debug,
  });

  // `/orgs/me` validates the API key and returns the org. We use it as a
  // 200-OK probe + identity surface; `/auth/me` was the historical name and
  // never existed in prod.
  const result = await client.get<{ id: string; name: string; slug: string }>('/orgs/me');

  await saveAuthConfig({
    apiKey,
    apiUrl,
    // The org slug is the closest stable identifier we have without a user
    // record. Stored as `email` in the config for backward compat with
    // existing config files (the field name is a misnomer at this point).
    email: result.slug,
  });

  output.success(`Authenticated via API key for org ${result.name}`);
}

async function loginWithCredentials(
  email: string,
  password: string,
  globals: GlobalOptions,
  output: Output,
): Promise<void> {
  const apiUrl = resolveApiUrl(globals);
  const client = new ApiClient({
    baseUrl: apiUrl,
    debug: globals.debug,
  });

  const result = await client.post<LoginResponse>('/auth/login', { email, password });

  await saveAuthConfig({
    token: result.token,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    apiUrl,
    email: result.email,
  });

  output.success(`Logged in as ${result.email}`);
}
