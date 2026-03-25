import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ProvisionOptions {
  agent: string;
}

interface VaultProvisionResponse {
  id: string;
  agentId: string;
  orgId: string;
  vaultUserId: string | null;
  vaultOrgId: string | null;
  collectionId: string | null;
  status: 'ACTIVE' | 'LOCKED' | 'ERROR';
  credentialCount: number;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function provisionCommand(): Command {
  return new Command('provision')
    .description('Provision vault for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<ProvisionOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.post<VaultProvisionResponse>('/api/v1/vault/provision', {
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Vault provisioned for agent ${opts.agent}`);
        output.details([
          ['Vault ID', result.id],
          ['Agent ID', result.agentId],
          ['Organization ID', result.orgId],
          ['Status', result.status],
          ['Credential Count', String(result.credentialCount)],
          ['Last Sync', result.lastSyncAt ?? 'Never'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to provision vault: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to provision vault: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
