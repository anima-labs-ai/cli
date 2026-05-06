import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CreateCardOptions {
  agent: string;
  label?: string;
  currency?: string;
  dailyLimit?: number;
  monthlyLimit?: number;
  perAuthLimit?: number;
}

function parseCents(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Must be a non-negative integer number of cents');
  }
  return parsed;
}

function formatMoney(cents: number | null | undefined): string | undefined {
  if (cents === undefined || cents === null) {
    return undefined;
  }

  return `$${(cents / 100).toFixed(2)}`;
}

export function createCardCommand(): Command {
  return new Command('create')
    .description('Create a virtual card')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--label <label>', 'Card label')
    .option('--currency <currency>', 'Card currency', 'usd')
    .option('--daily-limit <cents>', 'Daily spend limit in cents', parseCents)
    .option('--monthly-limit <cents>', 'Monthly spend limit in cents', parseCents)
    .option('--per-auth-limit <cents>', 'Per-authorization spend limit in cents', parseCents)
    .action(async function (this: Command) {
      const opts = this.opts<CreateCardOptions>();
      const globals = this.optsWithGlobals<CreateCardOptions & GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.create({
          agentId: opts.agent,
          label: opts.label,
          currency: opts.currency ?? 'usd',
          spendLimitDaily: opts.dailyLimit,
          spendLimitMonthly: opts.monthlyLimit,
          spendLimitPerAuth: opts.perAuthLimit,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Card ID', result.id],
          ['Agent ID', result.agentId],
          ['Label', result.label ?? '-'],
          ['Status', result.status],
          ['Currency', result.currency],
          ['Daily Limit', formatMoney(result.spendLimitDaily) ?? '-'],
          ['Monthly Limit', formatMoney(result.spendLimitMonthly) ?? '-'],
          ['Per Auth Limit', formatMoney(result.spendLimitPerAuth) ?? '-'],
          ['Created At', result.createdAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to create card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to create card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
