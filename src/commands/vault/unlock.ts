import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface UnlockOptions {
  ttl?: string;
  lock?: boolean;
}

interface UnlockSession {
  /** SHA-256 of the master-key plaintext — used to detect rotation */
  keyFingerprint: string;
  /** Random nonce proving the user went through the ceremony */
  nonce: string;
  /** Unix timestamp (seconds) after which this session is invalid */
  expiresAt: number;
  /** Whether the user acknowledged the reveal warning */
  warningAcknowledged: boolean;
}

function sessionFilePath(): string {
  // Scoped to the user account. 0600 perms enforced on write.
  return path.join(os.homedir(), '.anima', 'unlock.session.json');
}

async function readPasswordFromTty(prompt: string): Promise<string> {
  // Hide echo on POSIX; on Windows we fall back to plain readline.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const origWrite = process.stdout.write.bind(process.stdout);
  // Suppress echo by overriding write during the prompt.
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    if (typeof chunk === 'string' && chunk !== prompt && chunk !== '\n') return true;
    return (origWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const answer = await rl.question(prompt);
    return answer;
  } finally {
    process.stdout.write = origWrite;
    rl.close();
    process.stdout.write('\n');
  }
}

/**
 * `am vault unlock` — start a short-lived reveal session for the CURRENT user.
 *
 * This is the master-key ceremony mentioned in the technical plan: before the
 * CLI will reveal plaintext (`am vault get --unmask`), the user must explicitly
 * unlock. The session records a fingerprint of the master key, a nonce, and
 * a TTL. Every reveal within the TTL appends to the server-side audit log.
 *
 * Note: this is a LOCAL session marker. The server-side check still enforces
 * master-key auth — this is defense-in-depth so the reveal doesn't happen
 * silently the first time a user passes `--unmask`.
 */
export function unlockCommand(): Command {
  const cmd = new Command('unlock')
    .description('Start a master-key reveal session with explicit ceremony')
    .option('--ttl <seconds>', 'Session TTL in seconds (60–3600, default 300)', '300')
    .option('--lock', 'End the current unlock session immediately')
    .action(async function (this: Command) {
      const opts = this.opts<UnlockOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });
      const sessionPath = sessionFilePath();

      if (opts.lock) {
        try {
          await fs.unlink(sessionPath);
          output.success('Unlock session ended.');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          output.info('No active unlock session.');
        }
        return;
      }

      try {
        // Confirm the client has a usable master key on hand. We don't send
        // the key anywhere new — we just verify it works by hitting a
        // master-gated endpoint (the list endpoint already enforces this).
        const client = await requireAuth(globals);
        await client.get('/vault/identities', { limit: '1' });

        output.warn('You are about to start a plaintext-reveal session.');
        output.info('Every reveal within the TTL will be recorded in the audit log.');
        const answer = await readPasswordFromTty('Type "yes" to acknowledge: ');
        if (answer.trim().toLowerCase() !== 'yes') {
          output.error('Unlock aborted.');
          process.exit(1);
        }

        const ttl = Math.max(60, Math.min(3600, Number(opts.ttl) || 300));
        // Fingerprint is derived from the Authorization header material we
        // already have — no new secret is stored on disk.
        const apiKey = process.env.ANIMA_API_KEY ?? '';
        const fingerprint = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

        const session: UnlockSession = {
          keyFingerprint: fingerprint,
          nonce: crypto.randomBytes(16).toString('hex'),
          expiresAt: Math.floor(Date.now() / 1000) + ttl,
          warningAcknowledged: true,
        };

        await fs.mkdir(path.dirname(sessionPath), { recursive: true });
        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), { mode: 0o600 });

        output.success(`Unlock session active for ${ttl}s.`);
        output.info(`Ends: ${new Date(session.expiresAt * 1000).toISOString()}`);
        output.info('Run `am vault unlock --lock` to end early.');
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          if (error.status === 403) {
            output.error('Unlock requires a master key (mk_). Agent keys cannot unlock.');
          } else {
            output.error(`Unlock failed: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Unlock failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
  return cmd;
}

/**
 * Helper for other commands (`get --unmask`, etc.) to check whether a reveal
 * session is currently active. Returns null if not unlocked or expired.
 */
export async function readActiveUnlockSession(): Promise<UnlockSession | null> {
  try {
    const raw = await fs.readFile(sessionFilePath(), 'utf-8');
    const session = JSON.parse(raw) as UnlockSession;
    if (session.expiresAt * 1000 < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
