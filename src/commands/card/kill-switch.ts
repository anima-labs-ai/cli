import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface KillSwitchOptions {
  active?: boolean;
  inactive?: boolean;
  agent?: string;
  card?: string;
}

interface KillSwitchRequest {
  active: boolean;
  agentId?: string;
  cardId?: string;
}

interface KillSwitchResponse {
  active: boolean;
  agentId?: string;
  cardId?: string;
}

export function killSwitchCommand(): Command {
  return new Command('kill-switch')
    .description('Toggle card kill switch')
    .option('--active', 'Enable kill switch')
    .option('--inactive', 'Disable kill switch')
    .option('--agent <id>', 'Apply to agent cards')
    .option('--card <id>', 'Apply to a specific card')
    .action(async function (this: Command) {
      const opts = this.opts<KillSwitchOptions>();
      const globals = this.optsWithGlobals<KillSwitchOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if ((opts.active ?? false) === (opts.inactive ?? false)) {
        output.error('Specify exactly one of --active or --inactive');
        process.exit(1);
      }

      const body: KillSwitchRequest = {
        active: opts.active ?? false,
      };

      if (opts.agent !== undefined) {
        body.agentId = opts.agent;
      }

      if (opts.card !== undefined) {
        body.cardId = opts.card;
      }

      try {
        const client = await requireAuth(globals);
        const result = await client.post<KillSwitchResponse>('/api/v1/cards/kill-switch', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Active', result.active ? 'true' : 'false'],
          ['Agent ID', result.agentId],
          ['Card ID', result.cardId],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to toggle kill switch: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to toggle kill switch: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
