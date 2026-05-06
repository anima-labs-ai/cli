import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CredentialsOptions {
  agent: string;
}

interface VerifiableCredential {
  id: string;
  agentId: string;
  orgId: string;
  type: string;
  jwtVc: string;
  issuerDid: string;
  subjectDid: string;
  issuedAt: string;
  expiresAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
  revocationIndex: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
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
        const client = await requireAuth(globals);
        const credentials = await client.get<VerifiableCredential[]>(
          `/v1/agents/${opts.agent}/credentials`,
        );

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
        if (error instanceof ApiError) {
          output.error(`Failed to list credentials: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
