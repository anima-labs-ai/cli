import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CreatePodOptions {
  agent: string;
  name: string;
  image: string;
  cpu?: string;
  memory?: string;
  storage?: string;
}

interface PodResponse {
  id: string;
  agentId: string;
  name: string;
  image: string;
  status: string;
  createdAt: string;
}

export function createPodCommand(): Command {
  return new Command('create')
    .description('Create a compute pod for an agent')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--name <name>', 'Pod name')
    .requiredOption('--image <image>', 'Container image')
    .option('--cpu <cpu>', 'CPU allocation (e.g. 0.5, 1)')
    .option('--memory <memory>', 'Memory allocation (e.g. 256Mi, 1Gi)')
    .option('--storage <storage>', 'Storage allocation (e.g. 1Gi)')
    .action(async function (this: Command) {
      const opts = this.opts<CreatePodOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const body: Record<string, unknown> = {
          agentId: opts.agent,
          name: opts.name,
          image: opts.image,
        };

        const resources: Record<string, string> = {};
        if (opts.cpu) resources.cpu = opts.cpu;
        if (opts.memory) resources.memory = opts.memory;
        if (opts.storage) resources.storage = opts.storage;
        if (Object.keys(resources).length > 0) body.resources = resources;

        const client = await requireAuth(globals);
        const result = await client.post<PodResponse>('/api/v1/pods', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Pod ID', result.id],
          ['Agent ID', result.agentId],
          ['Name', result.name],
          ['Image', result.image],
          ['Status', result.status],
          ['Created', result.createdAt],
        ]);
        output.success('Pod created');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to create pod: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
