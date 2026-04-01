import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface PayOptions {
  agent: string;
  to: string;
  amount: string;
  currency?: string;
  memo?: string;
}

interface PayResponse {
  transactionId: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

export function walletPayCommand(): Command {
  return new Command('pay')
    .description('Send a payment from an agent wallet')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--to <address>', 'Recipient address')
    .requiredOption('--amount <amount>', 'Amount to send')
    .option('--currency <currency>', 'Currency (default: USD)')
    .option('--memo <memo>', 'Payment memo')
    .action(async function (this: Command) {
      const opts = this.opts<PayOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const body: Record<string, unknown> = {
          to: opts.to,
          amount: parseFloat(opts.amount),
        };
        if (opts.currency) body.currency = opts.currency;
        if (opts.memo) body.memo = opts.memo;

        const client = await requireAuth(globals);
        const result = await client.post<PayResponse>(`/agents/${opts.agent}/wallet/pay`, body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Transaction ID', result.transactionId],
          ['From', result.from],
          ['To', result.to],
          ['Amount', `${result.amount} ${result.currency}`],
          ['Status', result.status],
          ['Created', result.createdAt],
        ]);
        output.success('Payment sent');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to send payment: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
