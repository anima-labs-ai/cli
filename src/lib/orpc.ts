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

export { ORPCError };

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

