/**
 * SecretRef: the indirection primitive that lets configs live in source control
 * without containing plaintext. A ref is resolved at the edge of the agent — in
 * `am vault exec`, `am vault audit`, and `am vault proxy` — never shipped to
 * the LLM or the agent process in raw form.
 *
 * Three sources, matching OpenClaw's gateway/secrets pattern:
 *   - "anima" — fetch from the Anima vault by credentialId + dotted field path
 *   - "env"   — resolve from a local environment variable (fail if empty)
 *   - "exec"  — run a trusted binary (no shell) and capture stdout as the secret
 *
 * Design note: we deliberately do NOT support a "file" source in v1. File-based
 * secrets are a footgun on Windows (ACLs) and tempt folks to commit `.secrets/`
 * directories. If you need file-based, wrap it in an `exec` provider.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApiClient } from './api-client.js';

const execFileAsync = promisify(execFile);

export interface SecretRefAnima {
  source: 'anima';
  /** Credential ID (e.g. "cred_abc123") */
  credentialId: string;
  /** Dotted path into the credential object, e.g. "login.password", "apiKey.key" */
  field: string;
  /** Optional agent ID override (useful for master-key access across agents) */
  agentId?: string;
}

export interface SecretRefEnv {
  source: 'env';
  /** Environment variable name — must match /^[A-Z][A-Z0-9_]{0,127}$/ */
  name: string;
}

export interface SecretRefExec {
  source: 'exec';
  /** Absolute path or bare name of a trusted binary — NO shell expansion */
  command: string;
  /** Arguments passed to the binary (strings only, no globbing) */
  args?: string[];
  /** Env vars to pass through to the subprocess (others are stripped) */
  passEnv?: string[];
  /** Optional working directory */
  cwd?: string;
}

export type SecretRef = SecretRefAnima | SecretRefEnv | SecretRefExec;

export interface AnimaConfig {
  /** Map of logical name -> SecretRef. Keys are env var names by convention. */
  secrets?: Record<string, SecretRef>;
}

/** Narrow unknown JSON into a SecretRef (with validation). Throws on malformed input. */
export function parseSecretRef(name: string, raw: unknown): SecretRef {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`secrets.${name}: expected object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  const source = obj.source;

  if (source === 'anima') {
    if (typeof obj.credentialId !== 'string' || typeof obj.field !== 'string') {
      throw new Error(`secrets.${name}: "anima" source requires credentialId + field`);
    }
    return {
      source: 'anima',
      credentialId: obj.credentialId,
      field: obj.field,
      agentId: typeof obj.agentId === 'string' ? obj.agentId : undefined,
    };
  }

  if (source === 'env') {
    if (typeof obj.name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(obj.name)) {
      throw new Error(`secrets.${name}: "env" source requires uppercase name matching ^[A-Z][A-Z0-9_]{0,127}$`);
    }
    return { source: 'env', name: obj.name };
  }

  if (source === 'exec') {
    if (typeof obj.command !== 'string' || obj.command.length === 0) {
      throw new Error(`secrets.${name}: "exec" source requires non-empty command`);
    }
    // Disallow shell metacharacters in the command name — users must point at a real binary.
    if (/[\s;&|<>$`\\]/.test(obj.command)) {
      throw new Error(`secrets.${name}: exec command must not contain shell metacharacters`);
    }
    const args = Array.isArray(obj.args) ? obj.args.map(String) : undefined;
    const passEnv = Array.isArray(obj.passEnv) ? obj.passEnv.map(String) : undefined;
    const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;
    return { source: 'exec', command: obj.command, args, passEnv, cwd };
  }

  throw new Error(`secrets.${name}: unknown source "${String(source)}" (expected "anima" | "env" | "exec")`);
}

/** Load and validate anima.json (or a given config path). Returns empty config if file absent. */
export async function loadAnimaConfig(startDir: string = process.cwd()): Promise<{
  config: AnimaConfig;
  configPath: string | null;
}> {
  // Walk up directories looking for anima.json, same pattern as .gitignore/package.json.
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, 'anima.json');
    try {
      const buf = await fs.readFile(candidate, 'utf-8');
      const parsed = JSON.parse(buf) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`${candidate}: expected JSON object`);
      }
      const raw = parsed as Record<string, unknown>;
      const config: AnimaConfig = {};
      if (raw.secrets && typeof raw.secrets === 'object') {
        config.secrets = {};
        for (const [name, val] of Object.entries(raw.secrets as Record<string, unknown>)) {
          config.secrets[name] = parseSecretRef(name, val);
        }
      }
      return { config, configPath: candidate };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { config: {}, configPath: null };
    dir = parent;
  }
}

interface VaultCredential {
  id: string;
  type: string;
  name: string;
  notes?: string;
  login?: { username?: string; password?: string; totp?: string };
  card?: { number?: string; code?: string; cardholderName?: string };
  identity?: Record<string, string>;
  apiKey?: { key?: string };
  oauthToken?: { accessToken?: string };
  certificate?: { privateKey?: string };
}

/** Extract a value from a credential using a dotted path (e.g. "login.password"). */
function extractField(cred: VaultCredential, field: string): string | undefined {
  const parts = field.split('.');
  if (parts.length === 1) {
    const val = (cred as unknown as Record<string, unknown>)[field];
    return typeof val === 'string' ? val : undefined;
  }
  const [section, key] = parts;
  const sub = (cred as unknown as Record<string, unknown>)[section];
  if (typeof sub !== 'object' || sub === null) return undefined;
  const val = (sub as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : undefined;
}

export interface ResolveOptions {
  /** If true, resolved secrets are also reported to the caller (for audit). Default false. */
  reportResolved?: boolean;
  /** Extra env vars to add on top of passEnv for exec providers. */
  parentEnv?: NodeJS.ProcessEnv;
}

export interface ResolveResult {
  /** Fully resolved secrets keyed by logical name. Handle with care. */
  values: Record<string, string>;
  /** Names that failed to resolve, with a short reason. */
  errors: Array<{ name: string; reason: string }>;
}

/**
 * Resolve a set of SecretRefs into plaintext values. The caller is responsible
 * for never letting the returned strings touch the LLM context.
 *
 * For "anima" refs we use the vtk_ single-use token flow, NOT a direct reveal,
 * so even if this process is compromised the audit trail records each access
 * as a distinct token exchange.
 */
export async function resolveSecretRefs(
  client: ApiClient,
  refs: Record<string, SecretRef>,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const values: Record<string, string> = {};
  const errors: Array<{ name: string; reason: string }> = [];

  for (const [name, ref] of Object.entries(refs)) {
    try {
      if (ref.source === 'env') {
        const v = (opts.parentEnv ?? process.env)[ref.name];
        if (!v) {
          errors.push({ name, reason: `env var ${ref.name} is unset or empty` });
          continue;
        }
        values[name] = v;
      } else if (ref.source === 'exec') {
        // Build a minimal env: only the vars listed in passEnv. This prevents
        // exec providers from leaking parent-process secrets sideways.
        const childEnv: NodeJS.ProcessEnv = {};
        for (const v of ref.passEnv ?? []) {
          const parent = opts.parentEnv ?? process.env;
          if (parent[v] !== undefined) childEnv[v] = parent[v];
        }
        // Always pass PATH so the binary can be found — strip everything else.
        if (!childEnv.PATH) childEnv.PATH = process.env.PATH;

        const { stdout } = await execFileAsync(ref.command, ref.args ?? [], {
          env: childEnv,
          cwd: ref.cwd,
          timeout: 15_000,
          maxBuffer: 1024 * 1024, // 1MB cap — secrets shouldn't be larger
        });
        values[name] = stdout.replace(/\r?\n$/, ''); // Trim trailing newline (matches `op read --no-newline`)
      } else if (ref.source === 'anima') {
        // Create a single-use vtk_ token then exchange it. This is two round-trips
        // instead of one, but each access produces a distinct audit log entry,
        // which is the whole point of tokens over direct reveal.
        const tokenRes = await client.post<{ token: string }>('/vault/token', {
          agentId: ref.agentId,
          credentialId: ref.credentialId,
          scope: 'autofill',
          ttlSeconds: 60,
        });
        const cred = await client.post<VaultCredential>('/vault/token/exchange', { token: tokenRes.token });
        const fieldVal = extractField(cred, ref.field);
        if (fieldVal === undefined) {
          errors.push({ name, reason: `credential ${ref.credentialId} has no field "${ref.field}"` });
          continue;
        }
        values[name] = fieldVal;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ name, reason: msg });
    }
  }

  return { values, errors };
}
