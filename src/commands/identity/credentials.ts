import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CredentialsOptions {
  agent: string;
}

export function listCredentialsCommand(): Command {
  return new Command('credentials')
    .description('List verifiable credentials for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<CredentialsOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const credentials = await orpc.identity.listCredentials({ agentId: opts.agent });

        if (globals.json) {
          output.json(credentials);
          return;
        }

        if (credentials.length === 0) {
          output.info('No credentials found');
          return;
        }

        output.table(
          ['ID', 'Type', 'Issuer', 'Subject', 'Issued', 'Expires', 'Revoked'],
          credentials.map((vc) => [
            vc.id,
            vc.type,
            vc.issuerDid,
            vc.subjectDid,
            vc.issuedAt,
            vc.expiresAt ?? 'Never',
            vc.revoked ? 'Yes' : 'No',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list credentials: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
