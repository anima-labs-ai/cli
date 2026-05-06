import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type ProtocolPreference = 'x402' | 'ap2' | 'card';

interface PayOptions {
  agent: string;
  to?: string;
  amount: string;
  currency?: string;
  memo?: string;
  protocol?: ProtocolPreference;
}

export function walletPayCommand(): Command {
  return new Command('pay')
    .description('Send a payment from an agent wallet')
    .requiredOption('--agent <id>', 'Agent ID')
    .requiredOption('--amount <cents>', 'Amount in smallest currency unit (e.g. cents)', validateAmount)
    .option('--to <merchant>', 'Merchant name or identifier')
    .option('--currency <currency>', 'ISO 4217 three-letter currency code (default: USD)')
    .option('--memo <memo>', 'Human-readable description of the payment')
    .option('--protocol <protocol>', 'Preferred payment protocol (x402|ap2|card)', validateProtocol)
    .action(async function (this: Command) {
      const opts = this.opts<PayOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.wallet.pay({
          agentId: opts.agent,
          amount: Number(opts.amount),
          currency: opts.currency ?? 'USD',
          merchant: opts.to,
          description: opts.memo,
          preferredProtocol: opts.protocol,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Transaction ID', result.transactionId],
          ['Amount', `${result.amount} ${result.currency}`],
          ['Protocol', result.protocol],
          ['Status', result.status],
          ['Timestamp', result.timestamp],
        ]);
        output.success('Payment sent');
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to send payment');
      }
    });
}

function validateAmount(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      'amount must be a positive integer in the smallest currency unit (cents)',
    );
  }
  return value;
}

function validateProtocol(value: string): ProtocolPreference {
  if (value === 'x402' || value === 'ap2' || value === 'card') {
    return value;
  }
  throw new InvalidArgumentError('protocol must be one of x402, ap2, card');
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
    } else if (error.status === 402) {
      output.error(`${context}: insufficient funds or limit exceeded — ${error.message}`);
    } else if (error.status === 403) {
      output.error('Forbidden: you do not have access to this wallet.');
    } else if (error.status === 404) {
      output.error('Wallet not found.');
    } else if (error.status === 409) {
      output.error(`${context}: ${error.message}`);
    } else {
      output.error(`${context}: ${error.message}`);
    }
  } else if (error instanceof Error) {
    output.error(`${context}: ${error.message}`);
  } else {
    output.error(context);
  }
  process.exit(1);
}
