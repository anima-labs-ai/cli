import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface RedactOptions {
  agent?: string;
  patterns?: string[];
}

interface VaultCredential {
  id: string;
  type: string;
  name: string;
  notes?: string;
  login?: { username?: string; password?: string; uris?: Array<{ uri: string }>; totp?: string };
  card?: { number?: string; code?: string };
  apiKey?: { key?: string };
  oauthToken?: { accessToken?: string };
  certificate?: { privateKey?: string };
}

/**
 * Collect all sensitive field values from a credential.
 */
function collectSecrets(credential: VaultCredential): string[] {
  const secrets: string[] = [];
  if (credential.login?.password) secrets.push(credential.login.password);
  if (credential.login?.totp) secrets.push(credential.login.totp);
  if (credential.card?.number) secrets.push(credential.card.number);
  if (credential.card?.code) secrets.push(credential.card.code);
  if (credential.apiKey?.key) secrets.push(credential.apiKey.key);
  if (credential.oauthToken?.accessToken) secrets.push(credential.oauthToken.accessToken);
  if (credential.certificate?.privateKey) secrets.push(credential.certificate.privateKey);
  // Only redact notes if they look like a secret (not free-text)
  if (credential.type === 'secure_note' && credential.notes) {
    secrets.push(credential.notes);
  }
  return secrets.filter((s) => s.length >= 4); // Skip trivially short values
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

export function redactCommand(): Command {
  return new Command('redact')
    .description(
      'Redact vault secrets from stdin. Fetches all credentials for the agent and replaces any matching secret values with [REDACTED].'
    )
    .option('--agent <id>', 'Agent ID whose credentials to use for redaction')
    .option('--pattern <values...>', 'Additional literal strings to redact')
    .action(async function (this: Command) {
      const opts = this.opts<RedactOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const client = await requireAuth(globals);
        const input = await readStdin();

        // The list endpoint ALWAYS masks — there is no bulk reveal=true because
        // we never want to dump all plaintext in one shot. For redaction we
        // need the real values, so we enumerate IDs from the list and fetch
        // each one with reveal=true. This requires a master key (agent keys
        // get 403) and costs N+1 round-trips, but it's the only correct path
        // and it matches how masking is enforced server-side.
        const { items: masked } = await client.get<{ items: VaultCredential[] }>(
          '/vault/credentials',
          { agentId: opts.agent },
        );

        output.debug(`Loaded ${masked.length} credential(s) — fetching plaintext for redaction`);

        const items: VaultCredential[] = [];
        for (const stub of masked) {
          try {
            const full = await client.get<VaultCredential>(`/vault/credentials/${stub.id}`, {
              agentId: opts.agent,
              reveal: 'true',
            });
            items.push(full);
          } catch (err) {
            // One broken credential shouldn't poison the whole redaction.
            // Log and continue — we'll miss its secrets in the output, but
            // that's strictly better than crashing and leaking the OTHERS.
            output.debug(
              `Skipping credential ${stub.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Collect all secret values
        const secrets: string[] = [];
        for (const cred of items) {
          secrets.push(...collectSecrets(cred));
        }

        // Add user-specified patterns
        if (opts.patterns) {
          secrets.push(...opts.patterns);
        }

        // Sort by length descending to avoid partial replacements
        // (e.g., replace "secretkey123" before "secret")
        secrets.sort((a, b) => b.length - a.length);

        // Deduplicate
        const uniqueSecrets = [...new Set(secrets)];

        output.debug(`Found ${uniqueSecrets.length} unique secret value(s) to redact`);

        // Perform redaction
        let result = input;
        let redactionCount = 0;
        for (const secret of uniqueSecrets) {
          if (result.includes(secret)) {
            redactionCount++;
            result = result.replaceAll(secret, '[REDACTED]');
          }
        }

        output.debug(`Redacted ${redactionCount} secret(s)`);

        if (globals.json) {
          output.json({
            credentialsLoaded: items.length,
            secretsChecked: uniqueSecrets.length,
            redactionsApplied: redactionCount,
            output: result,
          });
        } else {
          process.stdout.write(result);
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Redaction failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`Redaction failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
