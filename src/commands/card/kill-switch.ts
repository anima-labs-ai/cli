import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface KillSwitchOptions {
  active?: boolean;
  inactive?: boolean;
  agent?: string;
  card?: string;
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
      const output = Output.fromGlobals(globals);

      if ((opts.active ?? false) === (opts.inactive ?? false)) {
        output.error('Specify exactly one of --active or --inactive');
        process.exit(1);
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.killSwitch({
          active: opts.active ?? false,
          agentId: opts.agent,
          cardId: opts.card,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Active', result.active ? 'true' : 'false'],
          ['Affected', String(result.affected)],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to toggle kill switch: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to toggle kill switch: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
