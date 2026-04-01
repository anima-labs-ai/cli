import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface LookupOptions {
  did: string;
}

interface RegistryAgent {
  did: string;
  name: string;
  description: string | null;
  category: string | null;
  capabilities: string[];
  endpoints: Record<string, string>;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export function lookupAgentCommand(): Command {
  return new Command('lookup')
    .description('Look up an agent in the registry by DID')
    .requiredOption('--did <did>', 'Agent DID')
    .action(async function (this: Command) {
      const opts = this.opts<LookupOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<RegistryAgent>(`/registry/agents/${encodeURIComponent(opts.did)}`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['DID', result.did],
          ['Name', result.name],
          ['Description', result.description ?? '-'],
          ['Category', result.category ?? '-'],
          ['Capabilities', result.capabilities.join(', ') || '-'],
          ['Endpoints', Object.entries(result.endpoints).map(([k, v]) => `${k}: ${v}`).join('\n') || '-'],
          ['Verified', result.verified ? 'Yes' : 'No'],
          ['Created', result.createdAt],
          ['Updated', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to look up agent: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
