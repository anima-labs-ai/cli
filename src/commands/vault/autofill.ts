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

interface SearchResponse {
  items: VaultCredential[];
}

type OutputFormat = 'env' | 'dotenv' | 'json' | 'exec';

interface AutofillOptions {
  agent?: string;
  id?: string;
  uri?: string;
  query?: string;
  format: OutputFormat;
  prefix?: string;
  field?: string[];
  exec?: string;
  totp?: boolean;
}

/** Parse --field flags like "login.username:GH_USER" into mapping pairs. */
function parseFieldMappings(fields: string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!fields) return map;
  for (const f of fields) {
    const colonIdx = f.indexOf(':');
    if (colonIdx === -1) continue;
    const vaultPath = f.substring(0, colonIdx).trim();
    const envName = f.substring(colonIdx + 1).trim();
    if (vaultPath && envName) {
      map.set(vaultPath, envName);
    }
  }
  return map;
}

/** Extract a value from a credential by dotted path (e.g. "login.username"). */
function extractField(credential: VaultCredential, field: string): string | undefined {
  const parts = field.split('.');
  if (parts.length === 1) {
    if (field === 'name') return credential.name;
    if (field === 'notes') return credential.notes;
    if (field === 'id') return credential.id;
    if (field === 'type') return credential.type;
    return undefined;
  }
  if (parts.length === 2) {
    const [section, key] = parts;
    if (section === 'login' && key === 'uri') {
      return credential.login?.uris?.[0]?.uri;
    }
    const obj = credential[section as keyof VaultCredential];
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      const val = (obj as Record<string, unknown>)[key];
      return typeof val === 'string' ? val : undefined;
    }
  }
  return undefined;
}

/** Build default env var mappings based on credential type. */
function buildDefaultEnvVars(credential: VaultCredential): Map<string, string> {
  const vars = new Map<string, string>();

  switch (credential.type) {
    case 'login': {
      if (credential.login?.username) vars.set('USERNAME', credential.login.username);
      if (credential.login?.password) vars.set('PASSWORD', credential.login.password);
      if (credential.login?.uris?.[0]?.uri) vars.set('URI', credential.login.uris[0].uri);
      if (credential.login?.totp) vars.set('TOTP_SECRET', credential.login.totp);
      break;
    }
    case 'card': {
      if (credential.card?.cardholderName) vars.set('CARD_HOLDER', credential.card.cardholderName);
      if (credential.card?.number) vars.set('CARD_NUMBER', credential.card.number);
      if (credential.card?.brand) vars.set('CARD_BRAND', credential.card.brand);
      if (credential.card?.expMonth) vars.set('CARD_EXP_MONTH', credential.card.expMonth);
      if (credential.card?.expYear) vars.set('CARD_EXP_YEAR', credential.card.expYear);
      if (credential.card?.code) vars.set('CARD_CVV', credential.card.code);
      break;
    }
    case 'identity': {
      if (credential.identity) {
        for (const [key, value] of Object.entries(credential.identity)) {
          if (value) {
            vars.set(key.replace(/([A-Z])/g, '_$1').toUpperCase(), value);
          }
        }
      }
      break;
    }
    case 'secure_note': {
      if (credential.notes) vars.set('NOTE', credential.notes);
      break;
    }
  }

  // Include custom fields
  if (credential.fields) {
    for (const field of credential.fields) {
      if (field.value) {
        const envKey = field.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        vars.set(envKey, field.value);
      }
    }
  }

  return vars;
}

/** Build env vars using explicit field mappings. */
function buildMappedEnvVars(credential: VaultCredential, mappings: Map<string, string>): Map<string, string> {
  const vars = new Map<string, string>();
  for (const [vaultPath, envName] of mappings) {
    const value = extractField(credential, vaultPath);
    if (value) {
      vars.set(envName, value);
    }
  }
  return vars;
}

/** Apply prefix to all env var names. */
function applyPrefix(vars: Map<string, string>, prefix: string): Map<string, string> {
  const prefixed = new Map<string, string>();
  for (const [key, value] of vars) {
    prefixed.set(`${prefix}${key}`, value);
  }
  return prefixed;
}

/** Shell-escape a value for export statements. */
function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/** Score a credential against a URI for best-match ranking. */
function scoreUriMatch(credential: VaultCredential, targetUri: string): number {
  if (!credential.login?.uris) return 0;
  const target = targetUri.toLowerCase();
  let best = 0;
  for (const credUri of credential.login.uris) {
    const uri = credUri.uri.toLowerCase();
    if (uri === target) return 100;
    if (target.includes(uri) || uri.includes(target)) best = Math.max(best, 50);
    // Domain match
    try {
      const targetHost = new URL(target.startsWith('http') ? target : `https://${target}`).hostname;
      const credHost = new URL(uri.startsWith('http') ? uri : `https://${uri}`).hostname;
      if (targetHost === credHost) best = Math.max(best, 80);
      // Subdomain match
      if (targetHost.endsWith(`.${credHost}`) || credHost.endsWith(`.${targetHost}`)) {
        best = Math.max(best, 60);
      }
    } catch {
      // URI parsing failed, skip
    }
  }
  return best;
}

export function autofillCommand(): Command {
  return new Command('autofill')
    .description(
      'Look up vault credentials and output them as environment variables, dotenv, JSON, or inject into a subprocess'
    )
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--id <credentialId>', 'Credential ID (direct lookup)')
    .option('--uri <uri>', 'Match credentials by URI/domain')
    .option('--query <search>', 'Search credentials by name')
    .option('--format <format>', 'Output format: env, dotenv, json (default: env)', 'env')
    .option('--prefix <prefix>', 'Prefix for environment variable names')
    .option('--field <mapping...>', 'Field mapping as vault.path:ENV_NAME (repeatable)')
    .option('--exec <command>', 'Run a command with credentials injected as env vars')
    .option('--totp', 'Include TOTP code if available')
    .action(async function (this: Command) {
      const opts = this.opts<AutofillOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        if (!opts.id && !opts.uri && !opts.query) {
          output.error('Provide at least one of --id, --uri, or --query to locate credentials.');
          process.exit(1);
        }

        const client = await requireAuth(globals);
        let credential: VaultCredential;

        if (opts.id) {
          // Direct lookup by ID
          output.debug(`Looking up credential by ID: ${opts.id}`);
          credential = await client.get<VaultCredential>(
            `/vault/credentials/${opts.id}`,
            { agentId: opts.agent },
          );
        } else {
          // Search by URI or query
          const searchTerm = opts.uri ?? opts.query ?? '';
          output.debug(`Searching credentials for: ${searchTerm}`);
          const params: Record<string, string | undefined> = {
            agentId: opts.agent,
            search: searchTerm,
          };

          const result = await client.get<SearchResponse>('/vault/search', params);

          if (result.items.length === 0) {
            output.error(`No credentials found matching "${searchTerm}".`);
            process.exit(1);
          }

          // Pick the best match
          if (opts.uri && result.items.length > 1) {
            // Rank by URI similarity
            const scored = result.items
              .map((item) => ({ item, score: scoreUriMatch(item, opts.uri!) }))
              .sort((a, b) => b.score - a.score);
            credential = scored[0].item;
            output.debug(`Best match: ${credential.name} (score: ${scored[0].score})`);
          } else {
            // Prefer favorites, then most recently updated
            const sorted = [...result.items].sort((a, b) => {
              if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
              return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
            });
            credential = sorted[0];
          }

          if (result.items.length > 1) {
            output.debug(`Found ${result.items.length} matches, using: ${credential.name} (${credential.id})`);
          }
        }

        // Fetch TOTP if requested
        let totpCode: string | undefined;
        if (opts.totp) {
          try {
            const totpResult = await client.get<{ code: string; period: number }>(
              `/vault/totp/${credential.id}`,
              { agentId: opts.agent },
            );
            totpCode = totpResult.code;
          } catch {
            output.debug('TOTP not available for this credential');
          }
        }

        // Build env vars
        const fieldMappings = parseFieldMappings(opts.field);
        let envVars: Map<string, string>;

        if (fieldMappings.size > 0) {
          envVars = buildMappedEnvVars(credential, fieldMappings);
        } else {
          envVars = buildDefaultEnvVars(credential);
        }

        if (totpCode) {
          envVars.set(fieldMappings.size > 0 ? 'TOTP' : 'TOTP_CODE', totpCode);
        }

        if (opts.prefix) {
          envVars = applyPrefix(envVars, opts.prefix);
        }

        // Determine effective format
        const format: OutputFormat = opts.exec ? 'exec' : opts.format;

        // Output
        switch (format) {
          case 'env': {
            const lines: string[] = [];
            for (const [key, value] of envVars) {
              lines.push(`export ${key}=${shellEscape(value)}`);
            }
            process.stdout.write(lines.join('\n') + '\n');
            break;
          }
          case 'dotenv': {
            const lines: string[] = [];
            for (const [key, value] of envVars) {
              // Double-quote values, escaping embedded double quotes and newlines
              const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
              lines.push(`${key}="${escaped}"`);
            }
            process.stdout.write(lines.join('\n') + '\n');
            break;
          }
          case 'json': {
            const obj: Record<string, string> = {};
            for (const [key, value] of envVars) {
              obj[key] = value;
            }
            output.json({
              credentialId: credential.id,
              credentialName: credential.name,
              credentialType: credential.type,
              variables: obj,
            });
            break;
          }
          case 'exec': {
            const command = opts.exec!;
            output.debug(`Executing: ${command}`);
            const env = { ...process.env };
            for (const [key, value] of envVars) {
              env[key] = value;
            }
            const proc = Bun.spawn(['sh', '-c', command], {
              env,
              stdin: 'inherit',
              stdout: 'inherit',
              stderr: 'inherit',
            });
            const exitCode = await proc.exited;
            process.exit(exitCode);
            break;
          }
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Autofill failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Autofill failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
