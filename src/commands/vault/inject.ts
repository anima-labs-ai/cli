import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface InjectOptions {
  agent?: string;
}

interface VaultCredential {
  id: string;
  type: string;
  name: string;
  notes?: string;
  login?: { username?: string; password?: string; uris?: Array<{ uri: string }>; totp?: string };
  card?: { number?: string; cardholderName?: string; brand?: string; expMonth?: string; expYear?: string; code?: string };
  identity?: Record<string, string>;
  apiKey?: { key?: string };
  oauthToken?: { accessToken?: string };
  certificate?: { privateKey?: string };
}

/** Regex for vtk_ tokens */
const VTK_PATTERN = /vtk_[a-f0-9]{64}/g;

/** Regex for {{vault:credId:field}} templates */
const TEMPLATE_PATTERN = /\{\{vault:([^:}]+):([^}]+)\}\}/g;

/**
 * Get the "primary" secret value for a credential based on its type.
 */
function getPrimarySecret(credential: VaultCredential): string | undefined {
  switch (credential.type) {
    case 'login':
      return credential.login?.password;
    case 'api_key':
      return credential.apiKey?.key;
    case 'oauth_token':
      return credential.oauthToken?.accessToken;
    case 'certificate':
      return credential.certificate?.privateKey;
    case 'card':
      return credential.card?.number;
    case 'secure_note':
      return credential.notes;
    default:
      return undefined;
  }
}

/**
 * Extract a specific field from a credential using a dotted path.
 */
function extractField(credential: VaultCredential, field: string): string | undefined {
  const parts = field.split('.');
  if (parts.length === 1) {
    if (field === 'name') return credential.name;
    if (field === 'notes') return credential.notes;
    return undefined;
  }
  if (parts.length === 2) {
    const [section, key] = parts;
    const obj = credential[section as keyof VaultCredential];
    if (typeof obj === 'object' && obj !== null) {
      const val = (obj as Record<string, unknown>)[key];
      return typeof val === 'string' ? val : undefined;
    }
  }
  return undefined;
}

/**
 * Read all of stdin as a string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export function injectCommand(): Command {
  return new Command('inject')
    .description(
      'Detect vault references (vtk_ tokens and {{vault:...}} templates) in stdin, exchange them for real credentials, and output the injected text'
    )
    .option('--agent <id>', 'Agent ID (used for template credential lookups)')
    .action(async function (this: Command) {
      const opts = this.opts<InjectOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const input = await readStdin();

        // Step 1: Detect vtk_ tokens
        VTK_PATTERN.lastIndex = 0;
        const tokens: string[] = [];
        let match = VTK_PATTERN.exec(input);
        while (match !== null) {
          if (!tokens.includes(match[0])) tokens.push(match[0]);
          match = VTK_PATTERN.exec(input);
        }

        // Step 2: Detect {{vault:...}} templates
        TEMPLATE_PATTERN.lastIndex = 0;
        const templates: Array<{ template: string; credentialId: string; field: string }> = [];
        match = TEMPLATE_PATTERN.exec(input);
        while (match !== null) {
          templates.push({ template: match[0], credentialId: match[1], field: match[2] });
          match = TEMPLATE_PATTERN.exec(input);
        }

        output.debug(`Found ${tokens.length} token(s) and ${templates.length} template(s)`);

        if (tokens.length === 0 && templates.length === 0) {
          // No vault references - pass through unchanged
          process.stdout.write(input);
          return;
        }

        let result = input;

        // Step 3: Exchange tokens and substitute
        for (const token of tokens) {
          try {
            const credential = await client.post<VaultCredential>('/vault/token/exchange', { token });
            const secret = getPrimarySecret(credential);
            if (secret) {
              result = result.replaceAll(token, secret);
              output.debug(`Exchanged token ${token.substring(0, 12)}... -> ${credential.name}`);
            } else {
              output.debug(`Token ${token.substring(0, 12)}... resolved but no primary secret`);
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            output.debug(`Failed to exchange token ${token.substring(0, 12)}...: ${msg}`);
          }
        }

        // Step 4: Resolve template references.
        // inject explicitly needs plaintext to substitute into the template,
        // so we pass reveal=true. This requires a master key (mk_) — agent
        // keys cannot reveal plaintext and must use the vtk_ token flow.
        const credentialCache = new Map<string, VaultCredential>();
        for (const tmpl of templates) {
          try {
            let credential = credentialCache.get(tmpl.credentialId);
            if (!credential) {
              credential = await client.get<VaultCredential>(
                `/vault/credentials/${tmpl.credentialId}`,
                { agentId: opts.agent, reveal: 'true' },
              );
              credentialCache.set(tmpl.credentialId, credential);
            }
            const value = extractField(credential, tmpl.field);
            if (value) {
              result = result.replaceAll(tmpl.template, value);
              output.debug(`Resolved template ${tmpl.template} -> [${value.length} chars]`);
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            output.debug(`Failed to resolve template ${tmpl.template}: ${msg}`);
          }
        }

        // Step 5: Output injected text
        if (globals.json) {
          output.json({
            tokensResolved: tokens.length,
            templatesResolved: templates.length,
            output: result,
          });
        } else {
          process.stdout.write(result);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Injection failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Injection failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
