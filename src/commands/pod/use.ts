import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface UsageOptions {
  id: string;
}

interface PodUsage {
  podId: string;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage: number;
  networkIn: number;
  networkOut: number;
  uptimeSeconds: number;
  measuredAt: string;
}

export function podUsageCommand(): Command {
  return new Command('usage')
    .description('Get resource usage for a pod')
    .requiredOption('--id <id>', 'Pod ID')
    .action(async function (this: Command) {
      const opts = this.opts<UsageOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<PodUsage>(`/pods/${opts.id}/usage`);

        if (globals.json) {
          output.json(result);
          return;
        }

        const hours = Math.floor(result.uptimeSeconds / 3600);
        const mins = Math.floor((result.uptimeSeconds % 3600) / 60);

        output.details([
          ['Pod ID', result.podId],
          ['CPU Usage', `${result.cpuUsage}%`],
          ['Memory Usage', `${result.memoryUsage}%`],
          ['Storage Usage', `${result.storageUsage}%`],
          ['Network In', `${result.networkIn} bytes`],
          ['Network Out', `${result.networkOut} bytes`],
          ['Uptime', `${hours}h ${mins}m`],
          ['Measured At', result.measuredAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get pod usage: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
