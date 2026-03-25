import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CreateCardOptions {
  agent: string;
  label?: string;
  currency?: string;
  dailyLimit?: number;
  monthlyLimit?: number;
  perAuthLimit?: number;
}

interface CreateCardRequest {
  agentId: string;
  label?: string;
  currency?: string;
  spendLimitDaily?: number;
  spendLimitMonthly?: number;
  spendLimitPerAuth?: number;
  spendLimitWeekly?: number;
  spendLimitYearly?: number;
  spendLimitLifetime?: number;
  allowedMerchantCategories?: string[];
  blockedMerchantCategories?: string[];
  metadata?: Record<string, string>;
}

interface SpendLimits {
  daily?: number;
  monthly?: number;
  perAuth?: number;
  weekly?: number;
  yearly?: number;
  lifetime?: number;
}

interface Card {
  id: string;
  agentId: string;
  label?: string;
  status: string;
  currency: string;
  spendLimits?: SpendLimits;
  createdAt?: string;
  updatedAt?: string;
}

function parseCents(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Must be a non-negative integer number of cents');
  }
  return parsed;
}

function formatMoney(cents?: number): string | undefined {
  if (cents === undefined) {
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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const body: CreateCardRequest = {
        agentId: opts.agent,
        currency: opts.currency ?? 'usd',
      };

      if (opts.label !== undefined) {
        body.label = opts.label;
      }
      if (opts.dailyLimit !== undefined) {
        body.spendLimitDaily = opts.dailyLimit;
      }
      if (opts.monthlyLimit !== undefined) {
        body.spendLimitMonthly = opts.monthlyLimit;
      }
      if (opts.perAuthLimit !== undefined) {
        body.spendLimitPerAuth = opts.perAuthLimit;
      }

      try {
        const client = await requireAuth(globals);
        const result = await client.post<Card>('/api/v1/cards', body);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Card ID', result.id],
          ['Agent ID', result.agentId],
          ['Label', result.label],
          ['Status', result.status],
          ['Currency', result.currency],
          ['Daily Limit', formatMoney(result.spendLimits?.daily)],
          ['Monthly Limit', formatMoney(result.spendLimits?.monthly)],
          ['Per Auth Limit', formatMoney(result.spendLimits?.perAuth)],
          ['Created At', result.createdAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to create card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to create card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
