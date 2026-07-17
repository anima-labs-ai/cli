import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

export function domainDeliverabilityCommand(): Command {
  return new Command('deliverability')
    .description('Check domain deliverability metrics')
    .argument('<id>', 'Domain ID', requireNonEmptyArg('Domain ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.deliverability({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Domain', result.domain],
          ['Sent', String(result.sent)],
          ['Delivered', String(result.delivered)],
          ['Bounced', String(result.bounced)],
          ['Complained', String(result.complained)],
          ['Bounce Rate', formatRate(result.bounceRate)],
          ['Complaint Rate', formatRate(result.complaintRate)],
          ['Healthy', result.isHealthy ? 'Yes' : 'No'],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to fetch deliverability', { statusMessages: { 404: 'Domain not found.' } });
      }
    });
}
