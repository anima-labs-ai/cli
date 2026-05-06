import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface TotpOptions {
  agent?: string;
}

export function totpCommand(): Command {
  return new Command('totp')
    .description('Get TOTP code')
    .argument('<credentialId>', 'Credential ID')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<TotpOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.getTotp({ id: credentialId, agentId: opts.agent });

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
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 404) {
            output.error('Credential not found or has no TOTP secret.');
          } else {
            output.error(`Failed to get TOTP: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to get TOTP: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
