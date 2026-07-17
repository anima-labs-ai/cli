import { InvalidArgumentError } from 'commander';

/**
 * Commander parser rejecting a value the user never really supplied — `get ""`,
 * or a `"$ID"` that expanded to nothing. Works for both a positional
 * (`.argument('<id>', 'Draft ID', requireNonEmptyArg('Draft ID'))`) and an
 * option (`.requiredOption('--id <id>', 'Identity ID', …)`).
 *
 * Commander already rejects a *missing* `<id>`, but an empty string counts as
 * supplied and reaches the action, where it collapses the request path:
 * `/webhooks/{id}` becomes `/webhooks/`, which the API resolves to the list
 * route and answers 200 with a list payload. Rendering that as a single
 * resource then failed on a missing field, surfacing a TypeError as
 * "Failed to get webhook: …" — the API blamed for a usage mistake. Read
 * commands crashed; destructive ones were worse, reporting `Identity deleted: `
 * and exiting 0 for an id that was never sent. Rejecting the value here keeps
 * it off the wire entirely, and Commander reports it in the same shape as any
 * other usage error.
 *
 * Use for inputs that name a resource by id, where empty is never meaningful.
 * Inputs whose emptiness is a server-side or domain question (a search query, a
 * config value) are not this function's business.
 *
 * Whitespace-only is rejected but a padded value is passed through unchanged:
 * `"   "` is a value nobody meant to supply, while `" abc "` was supplied and
 * is simply wrong, and silently rewriting what the user typed would hide that.
 * It reaches the API and earns an honest 404.
 */
export function requireNonEmptyArg(label: string) {
  return (value: string): string => {
    if (value.trim() === '') {
      throw new InvalidArgumentError(`${label} cannot be empty.`);
    }
    return value;
  };
}
