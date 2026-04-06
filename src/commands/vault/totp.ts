import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface TotpOptions {
  agent?: string;
}

interface TotpResponse {
  code: string;
  period: number;
}

export function totpCommand(): Command {
  return new Command('totp')
    .description('Get TOTP code')
    .argument('<credentialId>', 'Credential ID')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<TotpOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<TotpResponse>(`/vault/totp/${credentialId}`, {
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`TOTP for credential ${credentialId}`);
        output.details([
          ['Code', result.code],
          ['Seconds Remaining', String(result.period)],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get TOTP: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get TOTP: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
