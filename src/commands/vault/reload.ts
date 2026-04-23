import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ReloadOptions {
  agent?: string;
}

/**
 * `am vault reload` — forces the server-side snapshot cache to refresh.
 *
 * This mirrors OpenClaw's `openclaw secrets reload`: after rotating a secret
 * at the provider (e.g. rotating a Stripe key in Stripe's dashboard), the
 * server's cached resolution is stale until we tell it to swap.
 *
 * Semantics: atomic swap. If the new snapshot fails to load, the last-known-good
 * stays active — a degraded mode preferable to serving no secrets at all.
 */
export function reloadCommand(): Command {
  return new Command('reload')
    .description('Reload vault snapshots on the server (use after rotating a secret at the provider)')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command) {
      const opts = this.opts<ReloadOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<{
          reloaded: boolean;
          agentId: string | null;
          snapshotVersion: number;
          previousVersion: number | null;
        }>('/vault/reload', { agentId: opts.agent });

        if (globals.json) {
          output.json(result);
          return;
        }

        if (result.reloaded) {
          output.success(`Reloaded snapshot v${result.snapshotVersion}`);
          if (result.previousVersion !== null) {
            output.info(`Previous: v${result.previousVersion}`);
          }
        } else {
          output.info('Snapshot already current; no reload needed.');
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          // Graceful fallback if server hasn't deployed /vault/reload yet.
          if (error.status === 404) {
            output.warn('Server does not yet support snapshot reload (API upgrade pending).');
            output.info('Secrets will pick up new values on next access.');
            return;
          }
          output.error(`Reload failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Reload failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
