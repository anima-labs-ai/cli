import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

type CredentialType = 'login' | 'secure_note' | 'card' | 'identity';

interface CredentialUri {
  uri: string;
  match?: 'domain' | 'host' | 'starts_with' | 'regex' | 'never';
}

interface LoginCredential {
  username?: string;
  password?: string;
  uris?: CredentialUri[];
  totp?: string;
}

interface CardCredential {
  cardholderName?: string;
  brand?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  code?: string;
}

interface IdentityCredential {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  company?: string;
  ssn?: string;
}

interface CustomField {
  name: string;
  value: string;
  type: 'text' | 'hidden' | 'boolean';
}

interface VaultCredential {
  id: string;
  type: CredentialType;
  name: string;
  notes?: string;
  login?: LoginCredential;
  card?: CardCredential;
  identity?: IdentityCredential;
  fields?: CustomField[];
  favorite: boolean;
  folderId?: string;
  organizationId?: string;
  collectionIds?: string[];
  createdAt: string;
  updatedAt: string;
}

interface StoreOptions {
  agent?: string;
  type: CredentialType;
  name: string;
  username?: string;
  password?: string;
  uri?: string;
}

interface CreateCredentialInput {
  agentId?: string;
  type: CredentialType;
  name: string;
  notes?: string;
  login?: LoginCredential;
  card?: CardCredential;
  identity?: IdentityCredential;
  fields?: CustomField[];
  favorite?: boolean;
  folderId?: string;
}

export function storeCommand(): Command {
  return new Command('store')
    .description('Store/create a vault credential')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--type <type>', 'Credential type', 'login')
    .requiredOption('--name <name>', 'Credential name')
    .option('--username <user>', 'Login username')
    .option('--password <pass>', 'Login password')
    .option('--uri <url>', 'Login URL')
    .action(async function (this: Command) {
      const opts = this.opts<StoreOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const requestBody = buildCreateCredentialInput(opts);
        const client = await requireAuth(globals);
        const result = await client.post<VaultCredential>('/vault/credentials', requestBody);

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
        if (error instanceof ApiError) {
          output.error(`Failed to store credential: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to store credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}

function buildCreateCredentialInput(options: StoreOptions): CreateCredentialInput {
  const input: CreateCredentialInput = {
    agentId: options.agent,
    type: options.type,
    name: options.name,
  };

  if (options.type === 'login') {
    const login: LoginCredential = {};

    if (options.username) {
      login.username = options.username;
    }

    if (options.password) {
      login.password = options.password;
    }

    if (options.uri) {
      login.uris = [{ uri: options.uri }];
    }

    input.login = login;
  }

  return input;
}
