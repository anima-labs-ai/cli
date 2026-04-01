import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface SearchOptions {
  query: string;
  category?: string;
}

interface RegistryAgent {
  did: string;
  name: string;
  description: string | null;
  category: string | null;
  verified: boolean;
}

interface SearchResponse {
  items: RegistryAgent[];
}

export function searchRegistryCommand(): Command {
  return new Command('search')
    .description('Search the agent registry')
    .requiredOption('--query <query>', 'Search query')
    .option('--category <category>', 'Filter by category')
    .action(async function (this: Command) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const query: Record<string, string> = { q: opts.query };
        if (opts.category) query.category = opts.category;

        const client = await requireAuth(globals);
        const response = await client.get<SearchResponse>('/registry/agents/search', query);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          output.info('No agents found');
          return;
        }

        output.table(
          ['DID', 'Name', 'Category', 'Verified'],
          response.items.map((item) => [
            item.did,
            item.name,
            item.category ?? '-',
            item.verified ? 'Yes' : 'No',
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to search registry: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
