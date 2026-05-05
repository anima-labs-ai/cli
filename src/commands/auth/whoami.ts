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
            output.error('Session expired. Run `anima auth login` again.');
          } else {
            output.error(`Failed to fetch account info: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to fetch account info: ${error.message}`);
        }
        process.exit(1);
      }

      const result = accountResult.data;
      const isHumanFormat = (globals.format ?? (globals.human ? 'human' : null)) === 'human';

      if (isHumanFormat || (!globals.json && !globals.format && !globals.human)) {
        // Human-readable path: pairs in details(), banner for update.
        if (isHumanFormat || globals.human) {
          output.details([
            ['Organization', result.name],
            ['Org ID', result.id],
            ['Slug', result.slug],
            ['Tier', result.tier],
            ['Auth Method', auth.apiKey ? 'API Key' : 'Token'],
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
      }

      // Agent / json / yaml / md / jsonl path: structured payload, embedded
      // update field so agents can act on it without parsing decoration.
      const payload = {
        org_id: result.id,
        org_name: result.name,
        org_slug: result.slug,
        tier: result.tier,
        auth_method: auth.apiKey ? 'api_key' : 'token',
        api_url: auth.apiUrl ?? 'http://localhost:4001',
        cli_version: pkg.version,
        ...(update ? { update } : {}),
      };
      output.payload(payload);
    });
}
