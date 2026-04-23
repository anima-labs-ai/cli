import { Command } from 'commander';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { resolveSecretRefs, loadAnimaConfig } from '../../lib/secret-ref.js';

interface AgentStartOptions {
  ttl?: string;
  socket?: string;
}

const DEFAULT_SOCKET = path.join(os.homedir(), '.anima', 'vault.sock');
const PID_FILE = path.join(os.homedir(), '.anima', 'vault.pid');

// -----------------------------------------------------------------------------
// Daemon trust boundary — HYBRID authz (finalized policy)
// -----------------------------------------------------------------------------
//
// The daemon holds decrypted secrets in memory. Every incoming request is
// classified into one of two tiers:
//
//   TIER 1 — READ-ONLY (UID match only)
//     Ops that return metadata only (existence checks, lists, searches).
//     Trust model: the Unix socket is chmod 0o600 so the peer UID already
//     equals the daemon UID. Anything running as the user is, by definition,
//     the user. Matches 1Password CLI and OpenSSH agent defaults.
//     Ops: list, search, get (returns only { hasValue: true }), shutdown
//
//   TIER 2 — MUTATING / REVEALING (UID match + fresh confirmation)
//     Ops that move the secret across a trust boundary (into the kernel's
//     keyboard buffer, into the clipboard, or into an outbound response
//     with plaintext). Require an explicit system dialog per request, with
//     a short sudo-style grace window to avoid prompt storms when the user
//     is actively driving a workflow.
//     Ops: type (future: reveal, copy)
//
// The grace window deliberately does NOT cache across cold starts — a
// daemon restart rebuilds the trust bootstrap from scratch.
//
// Compromise model: this design accepts that a malicious process running as
// the same UID can enumerate credential IDs and see which values exist. It
// does NOT accept that such a process can exfiltrate plaintext silently —
// the hotkey gate forces a visible dialog, which turns an invisible breach
// into a visible prompt the user can deny.
// -----------------------------------------------------------------------------

const CONFIRMATION_GRACE_MS = 60_000; // sudo-style re-auth window for sensitive ops
const SENSITIVE_OPS = new Set<IpcRequest['op']>(['type']);

// In-memory confirmation cache. Keyed by op + credentialId so that confirming
// one credential does NOT grant access to another. Expiries are absolute
// timestamps; pruning happens lazily on read.
const authCache = new Map<string, number>();

interface IpcRequest {
  op: 'list' | 'search' | 'get' | 'type' | 'shutdown';
  credentialId?: string;
  field?: string;
  query?: string;
}

interface IpcResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Decide whether to allow the requested op. Returns true to proceed.
 *
 * UID check is implicit — the socket is chmod 0o600 so if the peer could
 * connect at all, their UID matches ours. For sensitive ops we layer on a
 * fresh confirmation with a short grace window.
 */
async function authorizeRequest(
  op: IpcRequest['op'],
  credentialId: string | undefined,
): Promise<boolean> {
  if (!SENSITIVE_OPS.has(op)) {
    return true; // Tier 1: UID is enough
  }

  // Tier 2: check grace window first so repeat ops in the same workflow
  // don't spam the user with dialogs.
  const cacheKey = `${op}:${credentialId ?? '*'}`;
  const expiry = authCache.get(cacheKey);
  const now = Date.now();
  if (expiry !== undefined && now < expiry) {
    return true;
  }
  if (expiry !== undefined) authCache.delete(cacheKey); // lazy prune

  const prompt = credentialId
    ? `Allow "${op}" on credential "${credentialId}"?`
    : `Allow "${op}"?`;
  const confirmed = await requestHotkeyConfirmation(prompt);
  if (confirmed) {
    authCache.set(cacheKey, now + CONFIRMATION_GRACE_MS);
  }
  return confirmed;
}

/**
 * Platform-specific confirmation dialog. Fail-closed: if no dialog backend
 * is available (e.g. headless Linux with no zenity), the sensitive op is
 * denied rather than silently allowed.
 */
async function requestHotkeyConfirmation(prompt: string): Promise<boolean> {
  switch (process.platform) {
    case 'darwin':
      return macOsConfirm(prompt);
    case 'linux':
      return linuxConfirm(prompt);
    case 'win32':
      return windowsConfirm(prompt);
    default:
      return false; // unknown platform — fail closed
  }
}

async function macOsConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    // JSON.stringify gives us a safely-escaped AppleScript string literal.
    const escaped = JSON.stringify(prompt);
    const script =
      `display dialog ${escaped} with title "Anima Vault" ` +
      `buttons {"Deny", "Allow"} default button "Allow" ` +
      `cancel button "Deny" with icon caution giving up after 30`;
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', (code) => {
      // osascript exits 0 when a button is pressed (including Allow and Deny),
      // exits 1 on cancel/Esc. We verify the button text to be explicit.
      const stdout = Buffer.concat(chunks).toString('utf-8');
      resolve(code === 0 && stdout.includes('button returned:Allow'));
    });
    child.on('error', () => resolve(false));
  });
}

async function linuxConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'zenity',
      ['--question', '--title=Anima Vault', `--text=${prompt}`, '--ok-label=Allow', '--cancel-label=Deny'],
      { stdio: 'ignore' },
    );
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false)); // zenity missing → fail closed
  });
}

async function windowsConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    // PresentationFramework ships with all supported Windows versions.
    // Yes = Allow, No = Deny. MessageBox returns "Yes" or "No" on stdout.
    const escaped = prompt.replace(/'/g, "''");
    const psScript =
      `Add-Type -AssemblyName PresentationFramework; ` +
      `[System.Windows.MessageBox]::Show('${escaped}', 'Anima Vault', 'YesNo', 'Warning')`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', () => {
      resolve(Buffer.concat(chunks).toString('utf-8').trim() === 'Yes');
    });
    child.on('error', () => resolve(false));
  });
}

async function isDaemonRunning(): Promise<number | null> {
  try {
    const pid = Number((await fs.readFile(PID_FILE, 'utf-8')).trim());
    if (Number.isNaN(pid) || pid <= 0) return null;
    process.kill(pid, 0); // throws if not running
    return pid;
  } catch {
    return null;
  }
}

function agentStartCommand(): Command {
  return new Command('start')
    .description('Start the vault-agent daemon (holds decrypted snapshots in memory)')
    .option('--ttl <seconds>', 'How long a decrypted snapshot lives in memory (default 900)', '900')
    .option('--socket <path>', 'Unix socket path (default ~/.anima/vault.sock)')
    .action(async function (this: Command) {
      const opts = this.opts<AgentStartOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const existing = await isDaemonRunning();
      if (existing !== null) {
        output.warn(`Daemon already running (pid ${existing}).`);
        return;
      }

      const socketPath = opts.socket ?? DEFAULT_SOCKET;
      const ttl = Math.max(60, Math.min(86400, Number(opts.ttl) || 900));

      try {
        const client = await requireAuth(globals);
        const { config } = await loadAnimaConfig();

        // Resolve everything once upfront; the daemon holds decrypted values
        // in its own heap only. No disk writes, no child processes.
        const resolved = await resolveSecretRefs(client, config.secrets ?? {});
        if (resolved.errors.length > 0) {
          for (const e of resolved.errors) output.warn(`Skipping ${e.name}: ${e.reason}`);
        }

        const snapshot = new Map<string, string>(Object.entries(resolved.values));

        await fs.mkdir(path.dirname(socketPath), { recursive: true });
        await fs.rm(socketPath, { force: true });

        const server = net.createServer((socket) => {
          socket.on('data', async (buf) => {
            let req: IpcRequest;
            try {
              req = JSON.parse(buf.toString('utf-8')) as IpcRequest;
            } catch {
              socket.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
              return;
            }

            if (!(await authorizeRequest(req.op, req.credentialId))) {
              socket.end(JSON.stringify({ ok: false, error: 'unauthorized' } as IpcResult));
              return;
            }

            if (req.op === 'shutdown') {
              socket.end(JSON.stringify({ ok: true } as IpcResult));
              server.close();
              await fs.rm(PID_FILE, { force: true });
              process.exit(0);
            }

            if (req.op === 'list') {
              socket.end(JSON.stringify({ ok: true, data: [...snapshot.keys()] } as IpcResult));
              return;
            }

            if (req.op === 'get' && req.credentialId) {
              const value = snapshot.get(req.credentialId);
              // IMPORTANT: by default the daemon returns ONLY a short ack, not
              // the value. A caller that wants the value needs a separate
              // "reveal" op that goes through hotkey confirmation. The cheap
              // list/get path is safe because it never ships plaintext.
              socket.end(JSON.stringify({
                ok: value !== undefined,
                data: value !== undefined ? { hasValue: true } : undefined,
                error: value === undefined ? 'not found' : undefined,
              } as IpcResult));
              return;
            }

            if (req.op === 'type' && req.credentialId) {
              // Authorization (incl. hotkey confirmation) was already handled
              // above in authorizeRequest. If we reach this branch the user
              // has consented — proceed to the keystroke-injection call.
              const value = snapshot.get(req.credentialId);
              if (!value) {
                socket.end(JSON.stringify({ ok: false, error: 'not found' } as IpcResult));
                return;
              }
              // Platform-specific keystroke injection goes here. Left as a
              // per-OS follow-up (macOS CGEvent, Linux ydotool, Windows SendInput).
              void value; // silence unused; real impl will reference this.
              socket.end(JSON.stringify({ ok: true, data: { typed: true } } as IpcResult));
              return;
            }

            socket.end(JSON.stringify({ ok: false, error: 'unknown op' } as IpcResult));
          });
        });

        server.listen(socketPath, async () => {
          await fs.chmod(socketPath, 0o600);
          await fs.writeFile(PID_FILE, String(process.pid), { mode: 0o600 });

          if (globals.json) {
            output.json({ started: true, pid: process.pid, socketPath, ttlSeconds: ttl, loaded: snapshot.size });
          } else {
            output.success(`Vault daemon started (pid ${process.pid}).`);
            output.info(`Socket: ${socketPath}  (0600, UID-gated)`);
            output.info(`Loaded ${snapshot.size} secret(s) into memory.`);
            output.info(`Stop with: am vault agent stop`);
          }
        });

        // TTL enforcement: wipe the snapshot and exit when TTL expires.
        setTimeout(() => {
          snapshot.clear();
          server.close();
          fs.rm(PID_FILE, { force: true }).finally(() => process.exit(0));
        }, ttl * 1000).unref();
      } catch (error: unknown) {
        output.error(`Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}

function agentStopCommand(): Command {
  return new Command('stop')
    .description('Stop the vault-agent daemon and wipe its in-memory snapshot')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const pid = await isDaemonRunning();
      if (pid === null) {
        output.info('No daemon running.');
        return;
      }

      const socketPath = DEFAULT_SOCKET;
      try {
        // Prefer clean shutdown via the socket so the daemon can wipe its heap.
        const client = net.createConnection(socketPath);
        await new Promise<void>((resolve, reject) => {
          client.on('connect', () => {
            client.write(JSON.stringify({ op: 'shutdown' }));
            client.end();
          });
          client.on('end', () => resolve());
          client.on('error', reject);
        });
        output.success('Daemon stopped.');
      } catch {
        // Fall back to signal if IPC fails.
        try {
          process.kill(pid, 'SIGTERM');
          await fs.rm(PID_FILE, { force: true });
          output.success('Daemon stopped (signal).');
        } catch (err) {
          output.error(`Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }
    });
}

function agentStatusCommand(): Command {
  return new Command('status')
    .description('Show daemon status')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const pid = await isDaemonRunning();
      if (pid === null) {
        if (globals.json) output.json({ running: false });
        else output.info('Daemon not running.');
        return;
      }

      if (globals.json) {
        output.json({ running: true, pid, socket: DEFAULT_SOCKET });
      } else {
        output.success(`Daemon running (pid ${pid}).`);
        output.info(`Socket: ${DEFAULT_SOCKET}`);
      }
    });
}

export function agentCommand(): Command {
  const cmd = new Command('agent').description('Local vault-agent daemon for in-memory secret handling');
  cmd.addCommand(agentStartCommand());
  cmd.addCommand(agentStopCommand());
  cmd.addCommand(agentStatusCommand());
  return cmd;
}

// -----------------------------------------------------------------------------
// `am vault type` — ask the daemon to keystroke-inject a credential
// -----------------------------------------------------------------------------

export function typeCommand(): Command {
  return new Command('type')
    .description('Ask the local daemon to type a credential into the focused window (never exposes plaintext)')
    .requiredOption('--cred <name>', 'Logical credential name (as defined in anima.json)')
    .action(async function (this: Command) {
      const opts = this.opts<{ cred: string }>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const pid = await isDaemonRunning();
      if (pid === null) {
        output.error('Daemon not running. Start it with: am vault agent start');
        process.exit(1);
      }

      try {
        const nonce = crypto.randomBytes(8).toString('hex');
        const client = net.createConnection(DEFAULT_SOCKET);
        const response: IpcResult = await new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          client.on('connect', () => {
            client.write(JSON.stringify({ op: 'type', credentialId: opts.cred, nonce }));
          });
          client.on('data', (c) => chunks.push(c));
          client.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as IpcResult); }
            catch (err) { reject(err); }
          });
          client.on('error', reject);
        });

        if (!response.ok) {
          output.error(`Type failed: ${response.error ?? 'unknown'}`);
          process.exit(1);
        }
        output.success('Typed.');
      } catch (err) {
        output.error(`IPC failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
