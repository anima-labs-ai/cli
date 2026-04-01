import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type CardStatus = 'ACTIVE' | 'FROZEN' | 'CANCELED';

interface UpdateCardOptions {
  label?: string;
  status?: CardStatus;
  dailyLimit?: number;
  monthlyLimit?: number;
  perAuthLimit?: number;
}

interface UpdateCardRequest {
  label?: string;
  status?: CardStatus;
  spendLimits?: {
    daily?: number;
    monthly?: number;
    perAuth?: number;
  };
  categories?: {
    allowed?: string[];
    blocked?: string[];
  };
}

interface Card {
  id: string;
  agentId: string;
  label?: string;
  status: string;
  currency: string;
  spendLimits?: {
    daily?: number;
    monthly?: number;
    perAuth?: number;
    weekly?: number;
    yearly?: number;
    lifetime?: number;
  };
  updatedAt?: string;
}

function parseCents(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Must be a non-negative integer number of cents');
  }
  return parsed;
}

function parseStatus(value: string): CardStatus {
  const upper = value.toUpperCase();
  if (upper !== 'ACTIVE' && upper !== 'FROZEN' && upper !== 'CANCELED') {
    throw new InvalidArgumentError('Status must be ACTIVE, FROZEN, or CANCELED');
  }
  return upper;
}

function formatMoney(cents?: number): string | undefined {
  if (cents === undefined) {
    return undefined;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function updateCardCommand(): Command {
  return new Command('update')
    .description('Update card settings')
    .argument('<cardId>', 'Card ID')
    .option('--label <label>', 'Update card label')
    .option('--status <status>', 'Update status (ACTIVE|FROZEN|CANCELED)', parseStatus)
    .option('--daily-limit <cents>', 'Set daily spend limit in cents', parseCents)
    .option('--monthly-limit <cents>', 'Set monthly spend limit in cents', parseCents)
    .option('--per-auth-limit <cents>', 'Set per-authorization spend limit in cents', parseCents)
    .action(async function (this: Command, cardId: string) {
      const opts = this.opts<UpdateCardOptions>();
      const globals = this.optsWithGlobals<UpdateCardOptions & GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const hasSpendLimitUpdate =
        opts.dailyLimit !== undefined || opts.monthlyLimit !== undefined || opts.perAuthLimit !== undefined;

      const body: UpdateCardRequest = {};

      if (opts.label !== undefined) {
        body.label = opts.label;
      }

      if (opts.status !== undefined) {
        body.status = opts.status;
      }

      if (hasSpendLimitUpdate) {
        body.spendLimits = {};

        if (opts.dailyLimit !== undefined) {
          body.spendLimits.daily = opts.dailyLimit;
        }
        if (opts.monthlyLimit !== undefined) {
          body.spendLimits.monthly = opts.monthlyLimit;
        }
        if (opts.perAuthLimit !== undefined) {
          body.spendLimits.perAuth = opts.perAuthLimit;
        }
      }

      if (
        body.label === undefined &&
        body.status === undefined &&
        body.spendLimits === undefined
      ) {
        output.error('Provide at least one update: --label, --status, --daily-limit, --monthly-limit, or --per-auth-limit');
        process.exit(1);
      }

      try {
        const client = await requireAuth(globals);
        const result = await client.put<Card>(`/cards/${cardId}`, body);

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
          ['Updated At', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to update card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to update card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
