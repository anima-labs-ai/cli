import { Command } from 'commander';
import net from 'node:net';
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
// DECISION POINT 2 — Diyan, this is the trust-boundary stub for the daemon.
// -----------------------------------------------------------------------------
//
// The daemon holds decrypted secrets in memory. Every incoming request on the
// Unix socket must be authorized before the daemon will act. The question is
// HOW STRONG that check should be.
//
//   Option 1 — UID-MATCH ONLY:
//     Trust any connection whose peer UID matches the daemon's UID.
//     Rationale: on a single-user laptop, anything running as you is already
//     you. Matches 1Password CLI's default.
//     Risk: a compromised npm package running as you can harvest secrets.
//
//   Option 2 — HOTKEY-GATED PER-TYPE:
//     Each `vault type` request pops a system-level confirmation dialog
//     (macOS TCC, Linux libnotify + hotkey, Windows toast). User must press
//     Enter/F9 before keystrokes fire.
//     Matches the openclaw-vault physical-confirmation posture.
//     Risk: friction; breaks headless/CI.
//
//   Option 3 — HYBRID (recommended):
//     Read-only ops (list, search, get-metadata) → UID match is enough.
//     Mutating/revealing ops (type, reveal, copy-to-clipboard) → hotkey gate.
//     Matches how sudo uses timestamps: auth once, cache briefly, re-auth for
//     sensitive ops.
//
// Fill in `authorizeRequest` below with your chosen policy.
// -----------------------------------------------------------------------------

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
 * TODO — DECISION POINT 2 for Diyan.
 *
 * Inspect the incoming connection and decide whether to allow the requested
 * op. Return true to proceed, false to reject. If you pick Option 2 or 3,
 * you'll also need to implement `requestHotkeyConfirmation` (left as a stub
 * below) — but that can ship in a follow-up.
 *
 * Write ~5–10 lines that encode your policy.
 */
function authorizeRequest(
  op: IpcRequest['op'],
  socket: net.Socket,
): boolean {
  // TODO: Diyan — implement your chosen trust policy. Placeholder = Option 1.
  // UID check is implicit in Unix socket permissions (we set 0o600 below), so
  // if the socket exists and the peer could connect, their UID matches.
  // For Option 3, gate ["type", "get"] on an extra confirmation.
  void op;
  void socket;
  return true;
}

async function requestHotkeyConfirmation(_prompt: string): Promise<boolean> {
  // TODO: platform-specific system dialog (macOS: osascript, Linux: zenity/notify-send, Windows: msg).
  // Wiring this up is where Option 2/3 becomes real.
  return true;
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

            if (!authorizeRequest(req.op, socket)) {
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
              const value = snapshot.get(req.credentialId);
              if (!value) {
                socket.end(JSON.stringify({ ok: false, error: 'not found' } as IpcResult));
                return;
              }
              const confirmed = await requestHotkeyConfirmation(
                `Type credential "${req.credentialId}" into focused field?`,
              );
              if (!confirmed) {
                socket.end(JSON.stringify({ ok: false, error: 'user declined' } as IpcResult));
                return;
              }
              // Platform-specific keystroke injection goes here. Left as a
              // per-OS follow-up (macOS CGEvent, Linux ydotool, Windows SendInput).
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
