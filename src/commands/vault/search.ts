import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

type CredentialType =
  | 'login'
  | 'secure_note'
  | 'card'
  | 'identity'
  | 'oauth_token'
  | 'api_key'
  | 'certificate';

interface SearchOptions {
  agent?: string;
  query: string;
  type?: CredentialType;
}

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'login',
  'secure_note',
  'card',
  'identity',
  'oauth_token',
  'api_key',
  'certificate',
]);

function validateType(value: string): CredentialType {
  if (ALLOWED_TYPES.has(value)) return value as CredentialType;
  throw new InvalidArgumentError(
    `type must be one of ${[...ALLOWED_TYPES].join(', ')}`,
  );
}

export function searchCommand(): Command {
  return new Command('search')
    .description('Search credentials')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .requiredOption('--query <search>', 'Search query')
    .option('--type <type>', 'Credential type filter', validateType)
    .action(async function (this: Command) {
      const opts = this.opts<SearchOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.search({
          agentId: opts.agent,
          search: opts.query,
          type: opts.type,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Type', 'Name', 'Username', 'Favorite', 'Updated'],
          result.items.map((item) => [
            item.id,
            item.type,
            item.name,
            item.login?.username ?? '',
            item.favorite ? 'Yes' : 'No',
            item.updatedAt,
          ]),
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to search credentials: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to search credentials: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
