import { Command } from 'commander';
import { getApiClient, requireAuth } from '../../lib/auth.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import { Output } from '../../lib/output.js';

interface KeyRotateOptions {
  org: string;
}

interface RotateKeyResponse {
  key?: string;
  keyId?: string;
}

export function keyRotateCommand(): Command {
  return new Command('rotate')
    .description('Rotate API key')
    .requiredOption('--org <org>', 'Organization ID')
    .action(async function (this: Command) {
      const opts = this.opts<KeyRotateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        await requireAuth(globals);
        const api = await getApiClient(globals);
        const result = await api.post<RotateKeyResponse>('/admin/keys/rotate', { org: opts.org });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Org', opts.org],
          ['Key ID', result.keyId],
          ['New Key', result.key],
        ]);
        output.success('API key rotated successfully');
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
