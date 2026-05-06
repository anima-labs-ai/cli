import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

function formatMoney(cents: number | null | undefined): string | undefined {
  if (cents === undefined || cents === null) {
    return undefined;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function getCardCommand(): Command {
  return new Command('get')
    .description('Get card details')
    .argument('<cardId>', 'Card ID')
    .action(async function (this: Command, cardId: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.get({ cardId });

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
          ['Weekly Limit', formatMoney(result.spendLimitWeekly) ?? '-'],
          ['Yearly Limit', formatMoney(result.spendLimitYearly) ?? '-'],
          ['Lifetime Limit', formatMoney(result.spendLimitLifetime) ?? '-'],
          ['Allowed Categories', result.allowedMerchantCategories.length > 0 ? result.allowedMerchantCategories.join(', ') : '-'],
          ['Blocked Categories', result.blockedMerchantCategories.length > 0 ? result.blockedMerchantCategories.join(', ') : '-'],
          ['Metadata', Object.keys(result.metadata).length > 0 ? JSON.stringify(result.metadata) : '-'],
          ['Created At', result.createdAt],
          ['Updated At', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to get card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
