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

interface StoreOptions {
  agent?: string;
  type: CredentialType;
  name: string;
  username?: string;
  password?: string;
  uri?: string;
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

interface LoginCredentialPayload {
  username?: string;
  password?: string;
  uris?: { uri: string }[];
}

export function storeCommand(): Command {
  return new Command('store')
    .description('Store/create a vault credential')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--type <type>', 'Credential type', validateType, 'login' as CredentialType)
    .requiredOption('--name <name>', 'Credential name')
    .option('--username <user>', 'Login username')
    .option('--password <pass>', 'Login password')
    .option('--uri <url>', 'Login URL')
    .action(async function (this: Command) {
      const opts = this.opts<StoreOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        let login: LoginCredentialPayload | undefined;
        if (opts.type === 'login') {
          login = {};
          if (opts.username) login.username = opts.username;
          if (opts.password) login.password = opts.password;
          if (opts.uri) login.uris = [{ uri: opts.uri }];
        }

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.create({
          agentId: opts.agent,
          type: opts.type,
          name: opts.name,
          login,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.success(`Stored credential ${result.name}`);
        output.details([
          ['Credential ID', result.id],
          ['Type', result.type],
          ['Name', result.name],
          ['Username', result.login?.username],
          ['URI', result.login?.uris?.[0]?.uri],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else {
            output.error(`Failed to store credential: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to store credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
