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
import { type ElevatedSession, elevateWithGrant, withElevation } from './elevation.js';
import type { Output } from './output.js';

export { ORPCError };

/** Per-condition message overrides for {@link handleOrpcError}. */
export interface OrpcErrorMessages {
  /** Message for a specific HTTP status, e.g. `{ 404: 'Domain not found.' }`. */
  statusMessages?: Record<number, string>;
  /**
   * Message for a specific oRPC error `code` (a non-status condition).
   * Checked BEFORE `statusMessages` — a code identifies the refusal, a status
   * only describes its shape.
   */
  codeMessages?: Record<string, string>;
}

/**
 * Wire codes that say nothing a status does not. Anything outside this set is
 * a typed refusal the server chose deliberately (MASTER_KEY_REQUIRED,
 * RECIPIENT_SUPPRESSED, TCPA_GATE_BLOCKED, VERIFICATION_REQUIRED …), and its
 * message is worth more than a per-command guess keyed on the status.
 */
const GENERIC_WIRE_CODES: ReadonlySet<string> = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYMENT_REQUIRED',
  'TOO_MANY_REQUESTS',
  'NOT_IMPLEMENTED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_SERVER_ERROR',
]);

/**
 * Text prepended to a typed refusal, for the ones where the CLI knows a way
 * out that the API cannot know about.
 *
 * MASTER_KEY_REQUIRED gates ~100 endpoints, and the server's message lists
 * three routes to master capability without saying which is available to
 * *this* caller — for an org created by `am init`, the answer is none of
 * them. Stepping up from the terminal is the CLI's own answer, so it belongs
 * here rather than repeated at every call site that might hit the wall.
 */
const TYPED_CODE_HINTS: Readonly<Record<string, string>> = {
  // Reaching this means auto-elevation did not run or did not help. The most
  // common reason by far is that there was no terminal to prompt in: the
  // step-up asks the OS for the login password, and a pipe, a CI job or an
  // agent has no way to answer. Naming a command would be worse than useless
  // here — every route to admin access goes through that same dialog, so the
  // only thing that changes the outcome is *where* the command is run.
  MASTER_KEY_REQUIRED:
    'This needs admin access. Run it from an interactive terminal, where it ' +
    'will ask for your password.\n',

  // An agent hit a master gate and a request was filed for its owner. This is
  // NOT the same wall as MASTER_KEY_REQUIRED, and conflating them is the whole
  // reason it gets its own hint: there, the caller could step up themselves;
  // here, someone else has to act, and retrying sooner changes nothing.
  //
  // No command is named. Filing again returns the same request rather than
  // notifying the owner twice, so "run X to check" would invite a poll loop
  // that achieves nothing. The server's own message carries the request id.
  APPROVAL_PENDING:
    'Waiting on your owner to approve this. Re-run it unchanged once they ' +
    'have — asking again in the meantime does not notify them twice.\n',

  // A standing decision of NEVER. Deliberately worded as settled rather than
  // pending: unlike APPROVAL_PENDING nothing is in flight, and an agent that
  // treats this as "retry later" will retry forever. Changing it needs a human
  // in the console, which is why no CLI command is offered.
  APPROVAL_DENIED:
    'Your owner has set this operation to Never for this agent. Retrying will ' +
    'not change that — it has to be changed in the console.\n',
};

/**
 * Turn an oRPC failure into a rendered CLI error and a non-zero exit, in one
 * place. Replaces the ~42 near-identical per-command `handleOrpcError` copies.
 *
 * Message resolution, most specific first: 401 → a fixed "authenticate" hint
 * (always — a `statusMessages` entry for 401 is ignored); then a matching
 * `codeMessages` entry; then, for a typed (non-generic) code, the server's own
 * message; then a matching `statusMessages` entry; otherwise
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

    // Most specific wins. This used to check `statusMessages` first, which
    // meant a per-status guess overrode the typed code underneath it: a 403
    // carrying MASTER_KEY_REQUIRED — "use a master key, or sign in as an org
    // owner" — was displayed as `identity create`'s "Forbidden: you do not
    // have access to this organization." That is not just vaguer, it is
    // false; the caller does have access, and the message sent them looking
    // for a permissions problem that does not exist.
    const byCode = messages?.codeMessages?.[error.code];
    if (byCode !== undefined) output.fatal(byCode);

    // A typed code means the server said something specific about this
    // refusal. Its message is then better than any status-shaped guess we
    // could substitute, so a status message only applies when the code is one
    // of the generic HTTP-ish ones that carries no extra information.
    if (!GENERIC_WIRE_CODES.has(error.code)) {
      output.fatal(`${TYPED_CODE_HINTS[error.code] ?? ''}${error.message}`);
    }

    const byStatus = messages?.statusMessages?.[error.status];
    if (byStatus !== undefined) output.fatal(byStatus);
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
 *
 * The returned client elevates on demand: see {@link withAutoElevation}.
 */
export async function requireOrpcAuth(opts: GlobalOptions): Promise<AnimaClient> {
  // Force a header check now so missing-auth errors surface before the
  // first network call (matches requireAuth's eager behavior).
  await ensureAuthHeaders(opts, { requireToken: true });
  const client = createOrpcClient(opts);

  // A GUI password dialog cannot be answered by a pipeline or a CI job, where
  // it would hang until timeout rather than fail outright. Interactive use is
  // the only place the prompt is a question rather than a stall — so the
  // decision to wrap lives here, and the wrapper itself stays pure.
  //
  // `stderr`, while enrolment in `elevation.ts` gates on `stdin`. They disagree
  // on purpose, because they guard different prompts: the OS password dialog is
  // a window, not a terminal read, so `am agent create < /dev/null` on an
  // enrolled Mac can still answer it — gating that on stdin would break a flow
  // that works. Enrolment really does read stdin, so stdin is what it checks.
  // Anything new that prompts has to pick the stream its own prompt reads from,
  // not copy whichever of these it saw first.
  if (!process.stderr.isTTY) return client;
  return withAutoElevation(client, opts);
}

/** Does this failure mean "you need master", whatever shape it arrived in? */
function isMasterKeyRequired(error: unknown): boolean {
  return error instanceof ORPCError && error.code === 'MASTER_KEY_REQUIRED';
}

/**
 * Step up, once, in response to a refusal — or report that we cannot.
 *
 * Returns the session rather than a boolean because the credential now has a
 * lifetime the caller has to bound. There is no longer a persisted session for
 * a later request to pick up, so the key has to travel from here to the one
 * call that needs it and stop there.
 *
 * There is deliberately no "already elevated, skip the dialog" check. That
 * check existed because a session lasted an hour, which is the same reason it
 * had to go: for that hour every process on the machine ran as master,
 * including an agent shelling out to `am`. Every master-gated command now pays
 * one dialog. That is the cost of the authority being no wider than the command
 * that asked for it.
 */
async function elevateForRetry(opts: GlobalOptions): Promise<ElevatedSession | null> {
  try {
    return await elevateWithGrant(opts);
  } catch {
    // Not enrolled, grant revoked, exchange refused — all end the same way for
    // the caller: they see the server's own MASTER_KEY_REQUIRED message, which
    // already says what admin access needs.
    return null;
  }
}

/**
 * Wrap a client so a master-gated call elevates and retries instead of failing.
 *
 * This is what makes privileged commands feel like `sudo`: run `am identity
 * create`, the OS asks for your login password, the command proceeds. Nothing
 * per-command is needed — the wrapper keys off the server's typed
 * MASTER_KEY_REQUIRED, so the ~100 gated endpoints are covered by construction
 * and a newly-gated one is covered the day it ships. A hardcoded list of
 * privileged commands would have started drifting immediately.
 *
 * Retrying on the same client is deliberate and safe: `OpenAPILink` resolves
 * `url()` and `headers()` per request, so the second attempt resolves its
 * credential inside the elevation window rather than from anything left on
 * disk. Rebuilding the client would work too, and would only obscure that.
 *
 * What makes the retry privileged is `ensureAuthHeaders` reading the in-process
 * key: nothing is written down, so the second attempt is privileged only while
 * `withElevation` is on the stack. A holder nothing consumed would look
 * identical here and fail identically to the first attempt.
 *
 * The retry is not itself wrapped, so a command can prompt at most once.
 */
export function withAutoElevation(
  client: AnimaClient,
  opts: GlobalOptions,
  // Injected so a test can drive the retry logic without a keychain, a server,
  // or a `mock.module` on elevation.js — wholesale-mocking a module in this
  // repo silently drops the test file the moment that module gains an export.
  elevate: (opts: GlobalOptions) => Promise<ElevatedSession | null> = elevateForRetry,
): AnimaClient {
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        // `then` must not look callable, or this proxy is a thenable.
        //
        // `requireOrpcAuth` is async and returns this, so the async machinery
        // probes `.then` on every command. oRPC's client is a path-building
        // proxy where *every* access yields a callable, so the probe found one,
        // the wrapper turned it into an ordinary async function, and JS invoked
        // it for real — sending `then` down the wire as a procedure name and
        // killing every command with "expect a contract procedure at
        // then.apply" before it reached the network.
        //
        // Returning undefined makes `await` treat this as a plain value and
        // resolve to the wrapper. Passing oRPC's own guarded `then` through
        // instead would also stop the crash, but its apply-trap resolves to
        // *oRPC's* client rather than this one — auto-elevation would vanish
        // silently, which is worse than a crash. No contract procedure is
        // named `then`; oRPC assumes the same in `preventNativeAwait`.
        if (prop === 'then') return undefined;

        const value = Reflect.get(obj, prop, receiver) as unknown;

        // Symbols are protocol hooks (`Symbol.toPrimitive`, inspection, async
        // iteration), never contract procedures. Wrapping them would change
        // how the object behaves in language-level operations.
        if (typeof prop === 'symbol') return value;

        // Anything traversable gets wrapped and nothing is replaced.
        //
        // An oRPC path node is BOTH callable and traversable — `orpc.agent` is
        // a function *and* the way to reach `orpc.agent.create`. Returning a
        // plain async function for it, as this used to, satisfied the call
        // case and destroyed the traversal: `orpc.agent.create` came back
        // undefined. Nothing caught it, because the test fixture was a plain
        // object whose `agent` is not callable, so it took the recursive
        // branch that real usage never reached.
        //
        // Keeping the node itself as the proxy target preserves both: `get`
        // walks the path, and the `apply` trap below handles the call.
        if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
          return wrap(value as object);
        }
        return value;
      },

      async apply(obj, thisArg, args) {
        const call = obj as unknown as (...a: unknown[]) => Promise<unknown>;
        try {
          return await Reflect.apply(call, thisArg, args);
        } catch (error: unknown) {
          if (!isMasterKeyRequired(error)) throw error;
          process.stderr.write('This needs admin access — authenticating…\n');
          const session = await elevate(opts);
          if (session === null) throw error;
          // Deliberately the raw target, not the wrapped member: a second
          // refusal under the elevated key is a real answer, and re-entering
          // the wrapper here would prompt in a loop against a server that has
          // already said no.
          //
          // Inside `withElevation` so the credential is in force for exactly
          // this request and released the moment it settles — including when
          // it throws, which is the case that would otherwise leave a
          // privileged key live for the rest of the process.
          return withElevation(session, () => Reflect.apply(call, thisArg, args));
        }
      },
    });

  return wrap(client);
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

