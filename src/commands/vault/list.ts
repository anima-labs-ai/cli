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

interface ListResponse {
  items: VaultCredential[];
}

interface ListOptions {
  agent?: string;
}

export function listCommand(): Command {
  return new Command('list')
    .description('List credentials')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .action(async function (this: Command) {
      const opts = this.opts<ListOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<ListResponse>('/vault/credentials', {
          agentId: opts.agent,
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
        if (error instanceof ApiError) {
          output.error(`Failed to list credentials: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to list credentials: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
