import { Command, InvalidArgumentError } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
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
  generatePassword?: boolean;
  length?: number;
  // Negation flags (--no-uppercase, …): commander defaults these to true;
  // false means the user explicitly excluded the class.
  uppercase?: boolean;
  lowercase?: boolean;
  numbers?: boolean;
  special?: boolean;
  // api_key payload (broker config)
  provider?: string;
  key?: string;
  allowedHost: string[];
  authHeader?: string;
  authScheme?: string;
  revealPolicy?: 'standard' | 'brokered';
}

function collectHost(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function validateRevealPolicy(value: string): 'standard' | 'brokered' {
  if (value === 'standard' || value === 'brokered') return value;
  throw new InvalidArgumentError('reveal-policy must be standard or brokered');
}

interface GeneratePasswordPayload {
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  number?: boolean;
  special?: boolean;
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
    .option(
      '--generate-password',
      'Generate the login password server-side — it stays in the vault and only the credential ref is returned',
    )
    .option(
      '--length <number>',
      'Generated password length (8-128, default 24; requires --generate-password)',
      Number.parseInt,
    )
    .option('--no-uppercase', 'Exclude uppercase letters from the generated password')
    .option('--no-lowercase', 'Exclude lowercase letters from the generated password')
    .option('--no-numbers', 'Exclude numbers from the generated password')
    .option('--no-special', 'Exclude special characters from the generated password')
    .option('--provider <name>', 'api_key: provider name (e.g. openai, stripe)')
    .option('--key <value>', 'api_key: the key value (stored encrypted, read back masked)')
    .option(
      '--allowed-host <host>',
      'api_key: host the key may be brokered to via `vault use` (repeatable; fail-closed without any)',
      collectHost,
      [],
    )
    .option('--auth-header <header>', "api_key: header the broker injects into (default 'Authorization')")
    .option('--auth-scheme <scheme>', "api_key: value prefix before the key (default 'Bearer '; '' for raw)")
    .option(
      '--reveal-policy <policy>',
      "Reveal policy: 'brokered' = plaintext never returned to anyone, use-only",
      validateRevealPolicy,
    )
    .action(async function (this: Command) {
      const opts = this.opts<StoreOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        if (opts.generatePassword && opts.type !== 'login') {
          output.fatal('--generate-password is only valid with --type login');
        }
        const apiKeyFlagUsed =
          opts.provider !== undefined ||
          opts.key !== undefined ||
          opts.allowedHost.length > 0 ||
          opts.authHeader !== undefined ||
          opts.authScheme !== undefined;
        if (apiKeyFlagUsed && opts.type !== 'api_key') {
          output.fatal('--provider/--key/--allowed-host/--auth-header/--auth-scheme require --type api_key');
        }
        if (opts.type === 'api_key' && (!opts.provider || !opts.key)) {
          output.fatal('--type api_key requires --provider and --key');
        }
        if (opts.revealPolicy && opts.type !== 'api_key') {
          output.fatal('--reveal-policy is currently supported with --type api_key here; other types follow the server defaults (set the policy via console or SDK)');
        }

        // api_key store goes through the raw /v1 path: the broker fields
        // (allowedHosts/authHeader/authScheme) and revealPolicy are newer than
        // the pinned oRPC contracts, and the HTTP path is stable.
        if (opts.type === 'api_key') {
          const client = await requireAuth(globals);
          const apiKey: Record<string, unknown> = {
            provider: opts.provider,
            key: opts.key,
          };
          if (opts.allowedHost.length > 0) apiKey.allowedHosts = opts.allowedHost;
          if (opts.authHeader !== undefined) apiKey.authHeader = opts.authHeader;
          if (opts.authScheme !== undefined) apiKey.authScheme = opts.authScheme;

          const created = await client.post<{
            id: string;
            type: string;
            name: string;
            revealPolicy?: string;
            apiKey?: { provider?: string; allowedHosts?: string[] };
          }>('/v1/vault/credentials', {
            agentId: opts.agent,
            type: 'api_key',
            name: opts.name,
            apiKey,
            ...(opts.revealPolicy ? { revealPolicy: opts.revealPolicy } : {}),
          });

          if (globals.json) {
            output.json(created);
            return;
          }
          output.success(`Stored credential ${created.name}`);
          output.details([
            ['Credential ID', created.id],
            ['Type', created.type],
            ['Provider', created.apiKey?.provider],
            ['Broker hosts', created.apiKey?.allowedHosts?.join(', ') ?? '(none — broker refuses until set)'],
            ['Reveal policy', created.revealPolicy],
          ]);
          return;
        }
        if (opts.generatePassword && opts.password) {
          output.fatal('--generate-password and --password are mutually exclusive — omit --password to have the vault generate one');
        }
        const generationFlagUsed =
          opts.length !== undefined ||
          opts.uppercase === false ||
          opts.lowercase === false ||
          opts.numbers === false ||
          opts.special === false;
        if (generationFlagUsed && !opts.generatePassword) {
          output.fatal('Password generation options require --generate-password');
        }

        let login: LoginCredentialPayload | undefined;
        if (opts.type === 'login') {
          login = {};
          if (opts.username) login.username = opts.username;
          if (opts.password) login.password = opts.password;
          if (opts.uri) login.uris = [{ uri: opts.uri }];
        }

        // Send only what the user asked for — absent fields fall back to the
        // server defaults (24 chars, all character classes). The contract
        // field is `number`; the CLI flag stays `--numbers` like `generate`.
        let generatePassword: GeneratePasswordPayload | undefined;
        if (opts.generatePassword) {
          generatePassword = {};
          if (opts.length !== undefined) generatePassword.length = opts.length;
          if (opts.uppercase === false) generatePassword.uppercase = false;
          if (opts.lowercase === false) generatePassword.lowercase = false;
          if (opts.numbers === false) generatePassword.number = false;
          if (opts.special === false) generatePassword.special = false;
        }

        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.create({
          agentId: opts.agent,
          type: opts.type,
          name: opts.name,
          login,
          generatePassword,
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
          ...(opts.generatePassword
            ? ([['Password', 'generated — stored in vault, never returned']] as [
                string,
                string,
              ][])
            : []),
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError || error instanceof ApiError) {
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
