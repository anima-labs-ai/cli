import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

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
  categories?: {
    allowed?: string[];
    blocked?: string[];
  };
  metadata?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

function formatMoney(cents?: number): string | undefined {
  if (cents === undefined) {
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
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<Card>(`/api/v1/cards/${cardId}`);

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
          ['Weekly Limit', formatMoney(result.spendLimits?.weekly)],
          ['Yearly Limit', formatMoney(result.spendLimits?.yearly)],
          ['Lifetime Limit', formatMoney(result.spendLimits?.lifetime)],
          ['Allowed Categories', result.categories?.allowed?.join(', ')],
          ['Blocked Categories', result.categories?.blocked?.join(', ')],
          ['Metadata', result.metadata ? JSON.stringify(result.metadata) : undefined],
          ['Created At', result.createdAt],
          ['Updated At', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get card: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
