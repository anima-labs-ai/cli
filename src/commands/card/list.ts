import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type CardStatus = 'ACTIVE' | 'FROZEN' | 'CANCELED';

interface ListCardsOptions {
  agent?: string;
  status?: CardStatus;
  cursor?: string;
  limit?: number;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('Limit must be an integer between 1 and 100');
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

function formatMoney(cents: number | null | undefined): string {
  if (cents === undefined || cents === null) {
    return '-';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function listCardsCommand(): Command {
  return new Command('list')
    .description('List cards')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--status <status>', 'Filter by status (ACTIVE|FROZEN|CANCELED)', parseStatus)
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <n>', 'Page size (1-100)', parseLimit)
    .action(async function (this: Command) {
      const opts = this.opts<ListCardsOptions>();
      const globals = this.optsWithGlobals<ListCardsOptions & GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.cards.list({
          agentId: opts.agent,
          status: opts.status,
          cursor: opts.cursor,
          limit: opts.limit ?? 20,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Agent', 'Label', 'Status', 'Currency', 'Daily Limit', 'Created At'],
          result.items.map((card) => [
            card.id,
            card.agentId,
            card.label ?? '-',
            card.status,
            card.currency,
            formatMoney(card.spendLimitDaily),
            card.createdAt,
          ]),
        );

        if (result.cursor) {
          output.info(`Next cursor: ${result.cursor}`);
        }
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list cards: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list cards: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
