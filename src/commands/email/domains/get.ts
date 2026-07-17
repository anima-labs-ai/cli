import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

export function getDomainCommand(): Command {
  return new Command('get')
    .description('Get domain details')
    .argument('<id>', 'Domain ID', requireNonEmptyArg('Domain ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.get({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['ID', result.id],
          ['Domain', result.domain],
          ['Status', result.status],
          ['Verified', result.verified ? 'Yes' : 'No'],
          ['SPF Configured', result.spfConfigured ? 'Yes' : 'No'],
          ['DKIM Selector', result.dkimSelector ?? '-'],
          ['DMARC Configured', result.dmarcConfigured ? 'Yes' : 'No'],
          ['MX Configured', result.mxConfigured ? 'Yes' : 'No'],
          ['Feedback Enabled', result.feedbackEnabled ? 'Yes' : 'No'],
          ['Created At', result.createdAt],
        ]);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to get domain', { statusMessages: { 404: 'Domain not found.' } });
      }
    });
}
