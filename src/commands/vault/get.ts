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

interface GetOptions {
  agent: string;
}

export function getCommand(): Command {
  return new Command('get')
    .description('Get credential by ID')
    .argument('<credentialId>', 'Credential ID')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<GetOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const result = await client.get<VaultCredential>(`/api/v1/vault/credentials/${credentialId}`, {
          agentId: opts.agent,
        });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Credential ID', result.id],
          ['Type', result.type],
          ['Name', result.name],
          ['Username', result.login?.username],
          ['Password', result.login?.password],
          ['URI', result.login?.uris?.[0]?.uri],
          ['Favorite', result.favorite ? 'Yes' : 'No'],
          ['Updated At', result.updatedAt],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get credential: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Failed to get credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
