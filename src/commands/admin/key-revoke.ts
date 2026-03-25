import { Command } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';

interface KeyRevokeOptions {
  keyId: string;
  yes?: boolean;
}

interface RevokeKeyResponse {
  revoked?: boolean;
  keyId?: string;
}

export function keyRevokeCommand(): Command {
  return new Command('revoke')
    .description('Revoke API key')
    .requiredOption('--key-id <id>', 'API key ID to revoke')
    .option('--yes', 'Confirm key revocation without prompt')
    .action(async function (this: Command) {
      const opts = this.opts<KeyRevokeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if (!opts.yes) {
        output.error('Confirmation required. Re-run with --yes to revoke the key.');
        process.exit(1);
      }

      try {
        await requireAuth(globals);
        const api = await getApiClient(globals);
        const result = await api.post<RevokeKeyResponse>('/admin/keys/revoke', { keyId: opts.keyId });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Revoked API key ${result.keyId ?? opts.keyId}`);
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          output.error(err.message);
        } else {
          output.error(err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });
}
