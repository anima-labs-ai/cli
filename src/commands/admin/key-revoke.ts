import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { handleOrpcError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

interface KeyRevokeOptions {
  keyId: string;
  yes?: boolean;
}

export function keyRevokeCommand(): Command {
  // Was POST /v1/admin/keys/revoke, a route the API does not have. The real
  // one is DELETE /api-keys/{id}; `am admin key list` has no equivalent yet,
  // so the id still comes from the console or `apiKeys.list`.
  return new Command('revoke')
    .description('Revoke an API key')
    .requiredOption('--key-id <id>', 'API key ID to revoke', requireNonEmptyArg('API key ID'))
    .option('--yes', 'Confirm key revocation without prompt')
    .action(async function (this: Command) {
      const opts = this.opts<KeyRevokeOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      if (!opts.yes) {
        output.fatal('Confirmation required. Re-run with --yes to revoke the key.');
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.apiKeys.revoke({ id: opts.keyId });

        if (output.isMachineFormat()) {
          output.json(result);
          return;
        }

        output.success(`Revoked API key ${opts.keyId}`);
      } catch (err: unknown) {
        handleOrpcError(err, output, 'Failed to revoke API key');
      }
    });
}
