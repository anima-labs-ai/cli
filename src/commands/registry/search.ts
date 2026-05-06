import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface SearchOptions {
  query?: string;
  capability?: string;
  trustMin?: string;
  kyaLevel?: string;
  tags?: string;
  cursor?: string;
  limit?: string;
}

export function searchRegistryCommand(): Command {
  return new Command('search')
    .description('Search the agent registry')
    .option('--query <query>', 'Free-text search across name and description')
    .option('--capability <cap>', 'Filter by a specific capability')
    .option('--trust-min <number>', 'Minimum trust score (0-100)', validateTrustMin)
    .option('--kya-level <level>', 'Filter by KYA verification level')
    .option('--tags <tags>', 'Comma-separated tags (matches any)')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <number>', 'Page size (1-100, default 20)', validateLimit)
    .action(async function (this: Command) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.registry.search({
          query: opts.query,
          capability: opts.capability,
          trustMin: opts.trustMin ? Number(opts.trustMin) : undefined,
          kyaLevel: opts.kyaLevel,
          tags: opts.tags ? opts.tags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          cursor: opts.cursor,
          limit: opts.limit ? Number(opts.limit) : 20,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        if (result.items.length === 0) {
          output.info('No agents found');
          return;
        }

        output.table(
          ['DID', 'Name', 'Trust', 'KYA', 'Tags', 'Verified'],
          result.items.map((item) => [
            item.did,
            item.name,
            String(item.trustScore),
            item.kyaLevel,
            item.tags.join(', ') || '-',
            item.verified ? 'Yes' : 'No',
          ]),
          {
            summary: `Returned ${result.items.length} of ${result.total} entries.`,
            pagination: {
              total: result.total,
              has_more: result.nextCursor !== null,
              next_cursor: result.nextCursor,
            },
          },
        );
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to search registry');
      }
    });
}

function validateTrustMin(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new InvalidArgumentError('trust-min must be an integer between 0 and 100');
  }
  return value;
}

function validateLimit(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return value;
}

function handleOrpcError(error: unknown, output: Output, context: string): never {
  if (error instanceof ORPCError) {
    if (error.status === 401) {
      output.error('Not authenticated. Run `anima auth login` to authenticate.');
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
