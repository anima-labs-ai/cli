import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface ListOptions {
  agent?: string;
}

interface PodItem {
  id: string;
  agentId: string;
  name: string;
  image: string;
  status: string;
  createdAt: string;
}

interface ListResponse {
  items: PodItem[];
}

export function listPodsCommand(): Command {
  return new Command('list')
    .description('List compute pods')
    .option('--agent <id>', 'Filter by agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const query: Record<string, string> = {};
        if (opts.agent) query.agentId = opts.agent;

        const client = await requireAuth(globals);
        const response = await client.get<ListResponse>('/pods', query);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          output.info('No pods found');
          return;
        }

        output.table(
          ['ID', 'Agent', 'Name', 'Image', 'Status', 'Created'],
          response.items.map((item) => [
            item.id,
            item.agentId,
            item.name,
            item.image,
            item.status,
            item.createdAt,
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to list pods: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
