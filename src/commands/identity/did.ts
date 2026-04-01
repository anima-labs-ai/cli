import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface DidOptions {
  agent: string;
}

interface DidDocument {
  did: string;
  agentId: string;
  document: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function getDidCommand(): Command {
  return new Command('did')
    .description('Get the DID for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<DidOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<DidDocument>(`/agents/${opts.agent}/did`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['DID', result.did],
          ['Agent ID', result.agentId],
          ['Created', result.createdAt],
          ['Updated', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get DID: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
