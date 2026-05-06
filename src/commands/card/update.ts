import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type CardStatus = 'ACTIVE' | 'FROZEN' | 'CANCELED';

interface UpdateCardOptions {
  label?: string;
  status?: CardStatus;
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

function parseStatus(value: string): CardStatus {
  const upper = value.toUpperCase();
  if (upper !== 'ACTIVE' && upper !== 'FROZEN' && upper !== 'CANCELED') {
    throw new InvalidArgumentError('Status must be ACTIVE, FROZEN, or CANCELED');
  }
  return upper;
}

function formatMoney(cents: number | null | undefined): string | undefined {
  if (cents === undefined || cents === null) {
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
      const output = Output.fromGlobals(globals);

      const hasUpdate =
        opts.label !== undefined ||
        opts.status !== undefined ||
        opts.dailyLimit !== undefined ||
        opts.monthlyLimit !== undefined ||
        opts.perAuthLimit !== undefined;

      if (!hasUpdate) {
        output.error('Provide at least one update: --label, --status, --daily-limit, --monthly-limit, or --per-auth-limit');
        process.exit(1);
      }

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.update({
          cardId,
          label: opts.label,
          status: opts.status,
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
          ['Updated At', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to update card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to update card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
