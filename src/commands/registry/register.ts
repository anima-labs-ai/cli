import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface RegisterOptions {
  did: string;
  name: string;
  description?: string;
  category?: string;
  capabilities?: string;
}

interface RegistryAgent {
  did: string;
  name: string;
  description: string | null;
  category: string | null;
  capabilities: string[];
  verified: boolean;
  createdAt: string;
}

export function registerAgentCommand(): Command {
  return new Command('register')
    .description('Register an agent in the public registry')
    .requiredOption('--did <did>', 'Agent DID')
    .requiredOption('--name <name>', 'Display name')
    .option('--description <desc>', 'Agent description')
    .option('--category <category>', 'Category (e.g. assistant, tool, service)')
    .option('--capabilities <caps>', 'Comma-separated capabilities')
    .action(async function (this: Command) {
      const opts = this.opts<RegisterOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const body: Record<string, unknown> = {
          did: opts.did,
          name: opts.name,
        };
        if (opts.description) body.description = opts.description;
        if (opts.category) body.category = opts.category;
        if (opts.capabilities) body.capabilities = opts.capabilities.split(',').map(s => s.trim());

        const client = await requireAuth(globals);
        const result = await client.post<RegistryAgent>('/api/v1/registry/agents', body);

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
          ['Verified', result.verified ? 'Yes' : 'No'],
          ['Created', result.createdAt],
        ]);
        output.success('Agent registered');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to register agent: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
