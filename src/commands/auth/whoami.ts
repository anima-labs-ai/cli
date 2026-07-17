import { Command } from 'commander';
import pkg from '../../../package.json' with { type: 'json' };
import { getAuthConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import { checkForUpdate } from '../../lib/update-notifier.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import type { GlobalOptions } from '../../lib/auth.js';

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
        output.fatal('Not authenticated. Run `anima auth login` first.');
      }

      // Run update check in parallel with the API call. Update check times out
      // at 1.5s and silently returns null on failure, so it never blocks.
      const [accountResult, update] = await Promise.all([
        (async () => {
          try {
            const orpc = await requireOrpcAuth(globals);
            // org.me validates the credential and returns the org. We ignore
            // the (currently leaking) `masterKey` field server-side and surface
            // only safe fields below.
            const result = await orpc.org.me({});
            return { ok: true as const, data: result };
          } catch (error: unknown) {
            return { ok: false as const, error };
          }
        })(),
        checkForUpdate('@anima-labs/cli', pkg.version),
      ]);

      if (!accountResult.ok) {
        const error = accountResult.error;
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Session expired. Run `am auth login` again.');
          } else if (error.status === 404) {
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
