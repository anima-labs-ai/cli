import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/api-client.js';

interface DeliverabilityResponse {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  deliveryRate?: number;
  bounceRate?: number;
  complaintRate?: number;
  [key: string]: unknown;
}

function formatRate(rate: number | undefined): string | undefined {
  if (rate === undefined) {
    return undefined;
  }
  return `${(rate * 100).toFixed(2)}%`;
}

export function domainDeliverabilityCommand(): Command {
  return new Command('deliverability')
    .description('Check domain deliverability metrics')
    .argument('<id>', 'Domain ID')
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<DeliverabilityResponse>(`/domains/${id}/deliverability`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Sent', String(result.sent)],
          ['Delivered', String(result.delivered)],
          ['Bounced', String(result.bounced)],
          ['Complained', String(result.complained)],
          ['Delivery Rate', formatRate(result.deliveryRate)],
          ['Bounce Rate', formatRate(result.bounceRate)],
          ['Complaint Rate', formatRate(result.complaintRate)],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to fetch deliverability: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to fetch deliverability: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
