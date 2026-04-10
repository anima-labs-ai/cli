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
  agent?: string;
  unmask?: boolean;
}

function redactValue(value: string | undefined): string | undefined {
  if (!value) return value;
  return '****';
}

function redactCardNumber(value: string | undefined): string | undefined {
  if (!value) return value;
  return '****' + value.slice(-4);
}

export function getCommand(): Command {
  return new Command('get')
    .description('Get credential by ID')
    .argument('<credentialId>', 'Credential ID')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--unmask', 'Show raw credential values (passwords, tokens). Use with caution.')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<GetOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });
      const mask = !opts.unmask;

      if (opts.unmask) {
        output.warn('⚠ Displaying unmasked credentials. Do not share this output.');
      }

      try {
        const client = await requireAuth(globals);
        // The server masks by default. Pass reveal=true to get plaintext,
        // which requires a master key (mk_) — agent keys will get a 403.
        // This enforces defense-in-depth: the CLI is no longer the only
        // layer of protection. If someone hacks the CLI, they still can't
        // exfiltrate passwords without master-key auth.
        const result = await client.get<VaultCredential>(`/vault/credentials/${credentialId}`, {
          agentId: opts.agent,
          ...(opts.unmask ? { reveal: 'true' } : {}),
        });

        if (globals.json) {
          if (mask) {
            // Redact sensitive fields in JSON output
            const masked = { ...result };
            if (masked.login) {
              masked.login = { ...masked.login };
              if (masked.login.password) masked.login.password = '****';
              if (masked.login.totp) masked.login.totp = '****';
            }
            if (masked.card) {
              masked.card = { ...masked.card };
              if (masked.card.code) masked.card.code = '****';
              if (masked.card.number) masked.card.number = '****' + masked.card.number.slice(-4);
            }
            if (masked.identity) {
              masked.identity = { ...masked.identity };
              if (masked.identity.ssn) masked.identity.ssn = '****';
            }
            output.json(masked);
          } else {
            output.json(result);
          }
          return;
        }

        const password = mask ? redactValue(result.login?.password) : result.login?.password;
        const cardNumber = mask ? redactCardNumber(result.card?.number) : result.card?.number;
        const cardCode = mask ? redactValue(result.card?.code) : result.card?.code;
        const ssn = mask ? redactValue(result.identity?.ssn) : result.identity?.ssn;

        output.details([
          ['Credential ID', result.id],
          ['Type', result.type],
          ['Name', result.name],
          ['Username', result.login?.username],
          ['Password', password],
          ['URI', result.login?.uris?.[0]?.uri],
          ['Card Number', cardNumber],
          ['Card Code', cardCode],
          ['SSN', ssn],
          ['Favorite', result.favorite ? 'Yes' : 'No'],
          ['Updated At', result.updatedAt],
        ]);

        if (mask) {
          output.info('Sensitive fields masked. Use --unmask to reveal.');
        }
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
