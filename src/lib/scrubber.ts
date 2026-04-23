/**
 * Scrubber: given a set of secret values, replace any occurrence in a stream
 * chunk with "[REDACTED]" before the chunk reaches the parent's stdout/stderr.
 *
 * This is the last line of defense when a child process (e.g. a script invoked
 * via `am vault exec`) accidentally logs a secret. Without scrubbing, any
 * `console.log(process.env.STRIPE_KEY)` in the child would leak the secret to
 * the terminal — and from there, often to CI logs, screen-recordings, the LLM
 * reading the terminal, etc.
 *
 * There's a real trade-off in how aggressive the scrub should be. Read the TODO
 * in `buildScrubPolicy` before wiring this into `vault exec`.
 */

export interface ScrubPolicy {
  /** Substrings that must be replaced wherever they appear. */
  literals: string[];
  /** Replacement string (default "[REDACTED]"). */
  replacement: string;
  /** Minimum length — values shorter than this are NOT scrubbed (too many false positives). */
  minLength: number;
}

export function applyScrub(chunk: Buffer, policy: ScrubPolicy): Buffer {
  if (policy.literals.length === 0) return chunk;
  let text = chunk.toString('utf-8');
  // Sort longest-first so e.g. "sk_live_abc123def" is replaced before "sk_live_abc".
  const sorted = [...policy.literals].filter((s) => s.length >= policy.minLength).sort((a, b) => b.length - a.length);
  for (const literal of sorted) {
    if (text.includes(literal)) {
      text = text.split(literal).join(policy.replacement);
    }
  }
  return Buffer.from(text, 'utf-8');
}

/**
 * TODO — DECISION POINT 1 for Diyan.
 *
 * Build the scrub policy used by `am vault exec`. This function receives the
 * resolved secret values and returns the ScrubPolicy the parent process will
 * apply to the child's stdout/stderr.
 *
 * The decision is a security ↔ usability ↔ correctness trade-off:
 *
 *   Option A — SCRUB OFF BY DEFAULT:
 *     Return { literals: [], ... }. Fast, zero overhead, zero false positives.
 *     Matches `doppler run` / `op run` behavior. Philosophy: "if your child
 *     process logs secrets, that's a bug in the child — fix it there."
 *
 *   Option B — SCRUB ON BY DEFAULT, minLength 8:
 *     Return { literals: values, replacement: "[REDACTED]", minLength: 8 }.
 *     Safest. Catches accidental logs. BUT: breaks programs whose output
 *     happens to contain the same string (e.g. a secret that's coincidentally
 *     also a public URL path), and adds per-chunk CPU cost on stdout.
 *
 *   Option C — SCRUB ON, OPT-IN PER SECRET:
 *     Let the anima.json SecretRef declare `"scrub": true|false` per secret.
 *     Most flexible; puts the decision on the person who knows the secret's
 *     shape. But requires users to think about it per-secret.
 *
 *   Option D — SCRUB ON + `--no-scrub` FLAG:
 *     Secure by default, easy escape hatch. Probably the pragmatic middle.
 *
 * My recommendation is D, but you run this business — Composio, 1Password, and
 * Doppler have all made different choices here and none is obviously wrong.
 *
 * Write the function body (5–10 lines):
 *   - accept `resolvedValues: Record<string, string>` and `optsNoScrub: boolean`
 *   - return the ScrubPolicy your chosen option dictates
 *   - if Option C, you'll also need to thread a per-secret flag through
 *     `loadAnimaConfig` → this function; I've left that unwired for you to add
 */
export function buildScrubPolicy(
  resolvedValues: Record<string, string>,
  optsNoScrub: boolean,
): ScrubPolicy {
  // TODO: Diyan — implement your chosen scrub policy here.
  // Placeholder defaults to Option D (scrub on unless --no-scrub).
  if (optsNoScrub) {
    return { literals: [], replacement: '[REDACTED]', minLength: 8 };
  }
  return {
    literals: Object.values(resolvedValues),
    replacement: '[REDACTED]',
    minLength: 8,
  };
}
