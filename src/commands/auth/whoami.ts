import { Command } from 'commander';
import pkg from '../../../package.json' with { type: 'json' };
import { getAuthConfig } from '../../lib/config.js';
import { getApiClient } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';
import { checkForUpdate } from '../../lib/update-notifier.js';
import type { GlobalOptions } from '../../lib/auth.js';

/**
 * `/orgs/me` returns the full org record. We only consume non-secret fields
 * here — `masterKey` from the response is intentionally never read or shown
 * (a separate redaction task strips it server-side).
 *
 * Email / role are not part of the org record. A richer `/whoami` endpoint
 * (with Clerk-pulled email + role) is tracked as a follow-up.
 */
interface OrgMeResponse {
  id: string;
  name: string;
  slug: string;
  tier: string;
  kybStatus?: string;
  cardIssuingEnabled?: boolean;
}

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Display current authentication status')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({
        json: globals.json ?? false,
        human: globals.human ?? false,
        format: globals.format,
        debug: globals.debug ?? false,
      });

      const auth = await getAuthConfig();

      if (!auth.token && !auth.apiKey) {
        output.error('Not authenticated. Run `anima auth login` first.');
        process.exit(1);
      }

      // Run update check in parallel with the API call. Update check times out
      // at 1.5s and silently returns null on failure, so it never blocks.
      const [accountResult, update] = await Promise.all([
        (async () => {
          try {
            const client = await getApiClient(globals);
            // Was `/auth/me` — that route has never existed in prod. `/orgs/me`
            // exists and returns the org for the authenticated key; we ignore
            // the (currently leaking) `masterKey` field and surface only safe
            // fields below.
            const result = await client.get<OrgMeResponse>('/orgs/me');
            return { ok: true as const, data: result };
          } catch (error: unknown) {
            return { ok: false as const, error };
          }
        })(),
        checkForUpdate('@anima-labs/cli', pkg.version),
      ]);

      if (!accountResult.ok) {
        const error = accountResult.error;
        if (error instanceof ApiError) {
          if (error.status === 401) {
            output.error('Session expired. Run `am auth login` again.');
          } else if (error.status === 404) {
            // 404 on /orgs/me typically means the user is on a stale CLI
            // that's still hitting `/auth/me` (a route that never existed
            // in prod). Tell them how to fix it instead of leaking the
            // raw "Route not found" string from the API.
            output.error(
              'API endpoint not found — your CLI is out of date.\n' +
                'Fix: `npm install -g @anima-labs/cli@latest` (or remove ~/.anima/bin/anima if you have a stale Bun-compiled binary on PATH).',
            );
          } else if (error.status >= 500) {
            output.error(
              `Anima API returned ${error.status}. Check status.useanima.sh; if persisting, contact support@useanima.sh.`,
            );
          } else {
            output.error(`Failed to fetch account info: ${error.message} (${error.status})`);
          }
        } else if (error instanceof Error) {
          // Network errors (ENOTFOUND, ECONNREFUSED) — give actionable text.
          if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(error.message)) {
            output.error(
              `Could not reach Anima API at ${auth.apiUrl ?? 'https://api.useanima.sh'}. Check your network connection.`,
            );
          } else {
            output.error(`Failed to fetch account info: ${error.message}`);
          }
        }
        process.exit(1);
      }

      const result = accountResult.data;

      // Detect the auth credential type by token prefix. Stored in the
      // `apiKey` field for back-compat with older config files (the field
      // is a misnomer at this point — it actually holds whatever Bearer
      // credential the user authenticated with).
      const credential = auth.apiKey ?? '';
      const authMethod = credential.startsWith('oat_')
        ? 'OAuth (Anima Connect)'
        : credential.startsWith('mk_')
          ? 'Master key'
          : credential.startsWith('ak_')
            ? 'Agent key'
            : credential.startsWith('sk_')
              ? 'Scoped key'
              : credential.startsWith('stk_')
                ? 'Scoped token'
                : auth.token
                  ? 'Session token'
                  : 'API Key';

      // Human format includes the TTY-auto-detected case — `output.format`
      // is the canonical resolved value. Don't gate on `globals.human`
      // alone; that misses the auto-detection branch.
      if (output.format === 'human') {
        output.details([
          ['Organization', result.name],
          ['Org ID', result.id],
          ['Slug', result.slug],
          ['Tier', result.tier],
          ['Auth Method', authMethod],
          ['API URL', auth.apiUrl ?? 'http://localhost:4001'],
          ['CLI Version', pkg.version],
        ]);
        if (update) {
          output.warn(
            `Update available: ${update.current_version} → ${update.latest_version}. Run: ${update.update_command}`,
          );
        }
        return;
      }

      // Agent / json / yaml / md / jsonl path: structured payload, embedded
      // update field so agents can act on it without parsing decoration.
      // Machine-readable auth_method codes: agents branch on these to
      // decide whether to refresh tokens, prompt for re-login, etc.
      const authMethodCode = credential.startsWith('oat_')
        ? 'oauth'
        : credential.startsWith('mk_')
          ? 'master_key'
          : credential.startsWith('ak_')
            ? 'agent_key'
            : credential.startsWith('sk_')
              ? 'scoped_key'
              : credential.startsWith('stk_')
                ? 'scoped_token'
                : auth.token
                  ? 'session_token'
                  : 'api_key';

      const payload = {
        org_id: result.id,
        org_name: result.name,
        org_slug: result.slug,
        tier: result.tier,
        auth_method: authMethodCode,
        api_url: auth.apiUrl ?? 'http://localhost:4001',
        cli_version: pkg.version,
        ...(update ? { update } : {}),
      };
      output.payload(payload);
    });
}
