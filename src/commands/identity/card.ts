import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CardOptions {
  agent: string;
}

interface AgentCard {
  did: string;
  agentId: string;
  name: string;
  description: string | null;
  capabilities: string[];
  endpoints: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export function getAgentCardCommand(): Command {
  return new Command('card')
    .description('Get the public agent card')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<CardOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<AgentCard>(`/agents/${opts.agent}/card`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['DID', result.did],
          ['Agent ID', result.agentId],
          ['Name', result.name],
          ['Description', result.description ?? '-'],
          ['Capabilities', result.capabilities.join(', ') || '-'],
          ['Endpoints', Object.entries(result.endpoints).map(([k, v]) => `${k}: ${v}`).join('\n') || '-'],
          ['Created', result.createdAt],
          ['Updated', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get agent card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
