// Typed oRPC client for the Anima CLI. Wraps `@orpc/openapi-client`'s
// OpenAPILink with the CLI's existing OAuth refresh + test-mode + error
// handling so commands get compile-time-checked inputs/outputs derived
// straight from the @anima/contracts package — no more hardcoded path
// strings drifting from the server's contract.
//
// Usage from a command:
//
//     import { requireOrpcAuth, ORPCError } from '../../lib/orpc.js';
//     ...
//     const orpc = await requireOrpcAuth(globals);
//     const result = await orpc.identity.getAgentDid({ agentId: opts.agent });
//
// The result is typed as the contract's output schema.

import { contract } from '@anima/contracts';
import { ORPCError, createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';

import { type GlobalOptions, ensureAuthHeaders, resolveApiUrl } from './auth.js';
import { getAuthConfig } from './config.js';
import type { Output } from './output.js';

export { ORPCError };

/** Per-condition message overrides for {@link handleOrpcError}. */
export interface OrpcErrorMessages {
  /** Message for a specific HTTP status, e.g. `{ 404: 'Domain not found.' }`. */
  statusMessages?: Record<number, string>;
  /**
   * Message for a specific oRPC error `code` (a non-status condition).
   * Checked after `statusMessages`, so a status override wins when both match.
   */
  codeMessages?: Record<string, string>;
}

/**
 * Turn an oRPC failure into a rendered CLI error and a non-zero exit, in one
 * place. Replaces the ~42 near-identical per-command `handleOrpcError` copies.
 *
 * Message resolution, most specific first: 401 → a fixed "authenticate" hint
 * (always — a `statusMessages` entry for 401 is ignored); then a matching
 * `statusMessages` entry; then a matching `codeMessages` entry; otherwise
 * `"${context}: ${error.message}"`.
 *
 * Exits via `output.fatal` (never returns) — `output` is a typed parameter, so
 * the `never` narrows and the whole `process.exit` dance stays inside here.
 */
export function handleOrpcError(
  error: unknown,
  output: Output,
  context: string,
  messages?: OrpcErrorMessages,
): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.fatal('Not authenticated. Run `anima auth login` to authenticate.');
    }
    const byStatus = messages?.statusMessages?.[error.status];
    if (byStatus !== undefined) output.fatal(byStatus);
    const byCode = messages?.codeMessages?.[error.code];
    if (byCode !== undefined) output.fatal(byCode);
    output.fatal(`${context}: ${error.message}`);
  }
  if (error instanceof Error) output.fatal(`${context}: ${error.message}`);
  output.fatal(context);
}

export type AnimaClient = ContractRouterClient<typeof contract>;

/**
 * Build a typed oRPC client. URL and headers are resolved per-request:
 *   - `url()` reads the stored auth config and appends `/v1` so contract
 *     paths line up with the server's `prefix: "/v1/"` mount. Phase 2 of
 *     the prefix standardization moved versioning out of contract paths
 *     and into a single server-side prefix; the matching client-side
 *     prefix lives here.
 *   - `headers()` re-runs OAuth token refresh between calls so a long-
 *     running CLI process never falls off the 1h access-token cliff.
 */
export function createOrpcClient(opts: GlobalOptions): AnimaClient {
  const link = new OpenAPILink(contract, {
    url: async () => {
      const auth = await getAuthConfig();
      const base = resolveApiUrl(opts, auth.apiUrl).replace(/\/$/, '');
      return `${base}/v1`;
    },
    headers: async () => ensureAuthHeaders(opts),
    // The API normalizes errors into {error:{code,message,details}} which
    // doesn't match oRPC's default {defined,code,status,message} shape.
    // Decode the wrapped form back into a proper ORPCError so command
    // catch-blocks see real codes/messages instead of "INTERNAL_SERVER_ERROR".
    customErrorResponseBodyDecoder: (body, response) => {
      const wrapper = body as Record<string, unknown> | null | undefined;
      const err = wrapper?.error as Record<string, unknown> | undefined;
      if (err && typeof err.code === 'string' && typeof err.message === 'string') {
        return new ORPCError(err.code, {
          status: response.status,
          message: err.message,
          data: err.details,
        });
      }
      return undefined;
    },
  });

  return createORPCClient(link);
}

/**
 * Like `requireAuth` but returns the typed oRPC client. Throws if there's
 * no usable credential — matches the existing `requireAuth` contract so
 * callers can swap in place.
 */
export async function requireOrpcAuth(opts: GlobalOptions): Promise<AnimaClient> {
  // Force a header check now so missing-auth errors surface before the
  // first network call (matches requireAuth's eager behavior).
  await ensureAuthHeaders(opts, { requireToken: true });
  return createOrpcClient(opts);
}

/**
 * Build a typed oRPC client with explicit credentials, bypassing the
 * stored `auth.json`. Used by the login flow: when validating a freshly
 * minted OAuth access token or a user-provided API key, the credential
 * isn't on disk yet, so the standard `requireOrpcAuth` chicken-and-egg
 * doesn't apply. Caller passes the apiUrl + credential directly.
 */
export function createOrpcClientWithCredential(params: {
  apiUrl: string;
  credential: string;
  testMode?: boolean;
}): AnimaClient {
  const link = new OpenAPILink(contract, {
    url: () => `${params.apiUrl.replace(/\/$/, '')}/v1`,
    headers: () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.credential}`,
      };
      if (params.testMode) {
        headers['X-Anima-Test-Mode'] = '1';
      }
      return headers;
    },
    customErrorResponseBodyDecoder: (body, response) => {
      const wrapper = body as Record<string, unknown> | null | undefined;
      const err = wrapper?.error as Record<string, unknown> | undefined;
      if (err && typeof err.code === 'string' && typeof err.message === 'string') {
        return new ORPCError(err.code, {
          status: response.status,
          message: err.message,
          data: err.details,
        });
      }
      return undefined;
    },
  });

  return createORPCClient(link);
}

