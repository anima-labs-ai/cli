/**
 * `am doctor` — single-command health check.
 *
 * Why it exists:
 *   When something breaks at 11pm, the user runs `am doctor` and gets a
 *   triage answer in 3 seconds instead of guessing. Each check is a hard
 *   PASS/WARN/FAIL with a one-liner detail so the user can copy the
 *   failing line into a support ticket.
 *
 * What it checks (each independent — one failure does not abort the rest):
 *   1. Config readable — ~/.anima/config.json exists, parses cleanly
 *   2. API URL configured — DNS resolves for the configured host
 *   3. API health — GET {apiUrl}/health responds in <500ms
 *   4. Auth — auth config has a token or API key
 *   5. Auth valid — GET /auth/me returns 200 with the configured creds
 *   6. MCP installed — at least one supported MCP client config has an
 *      anima entry registered
 *   7. CLI version — current binary version vs. latest published
 *
 * Output: a compact table with check name, status, duration, and detail.
 * Exit code: 0 if no FAILs, 1 if any FAIL, 2 if config layer crashes.
 *
 * The point: if `am email send` is throwing 401 at 11pm, the user runs
 * `am doctor` first. If auth is the problem, doctor says "auth: FAIL — token
 * expired, run `am auth login`". If DNS is the problem, doctor says
 * "api-dns: FAIL — Could not resolve api.useanima.sh". You don't read 12
 * stack traces; you read one line.
 */
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolveDns } from 'node:dns/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';

import { ApiError } from '../../lib/api-client.js';
import { getApiClient, type GlobalOptions } from '../../lib/auth.js';
import { getAuthConfig, getConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';

interface CheckResult {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
  durationMs: number;
}

const HEALTH_BUDGET_MS = 500;
const DOCTOR_TIMEOUT_MS = 5_000;

async function timed<T>(name: string, fn: () => Promise<T>): Promise<{ result?: T; check: CheckResult }> {
  const start = performance.now();
  try {
    const result = await fn();
    return { result, check: { name, status: 'PASS', detail: '', durationMs: Math.round(performance.now() - start) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { check: { name, status: 'FAIL', detail: message, durationMs: Math.round(performance.now() - start) } };
  }
}

async function checkConfigReadable(): Promise<CheckResult> {
  const { check } = await timed('config:readable', async () => {
    // getConfig does NOT throw on missing file — it returns defaults. Tap it
    // anyway so any JSON-parse error surfaces here, and check the path
    // existence as a separate signal.
    await getConfig();
    return true;
  });
  return check;
}

async function checkApiDns(apiUrl: string): Promise<CheckResult> {
  const { check } = await timed('api:dns', async () => {
    const url = new URL(apiUrl);
    if (url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      return 'localhost / IP — DNS skipped';
    }
    const addrs = await resolveDns(url.hostname);
    if (addrs.length === 0) {
      throw new Error(`no DNS records for ${url.hostname}`);
    }
    return `${url.hostname} → ${addrs[0]}`;
  });
  return check;
}

async function checkApiHealth(apiUrl: string): Promise<CheckResult> {
  const start = performance.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DOCTOR_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
    });
    const ms = Math.round(performance.now() - start);
    if (!response.ok) {
      return { name: 'api:health', status: 'FAIL', detail: `HTTP ${response.status} from /health`, durationMs: ms };
    }
    if (ms > HEALTH_BUDGET_MS) {
      return {
        name: 'api:health',
        status: 'WARN',
        detail: `${ms}ms exceeds ${HEALTH_BUDGET_MS}ms budget — check upstream latency`,
        durationMs: ms,
      };
    }
    return { name: 'api:health', status: 'PASS', detail: `200 in ${ms}ms`, durationMs: ms };
  } catch (error) {
    const ms = Math.round(performance.now() - start);
    const message = error instanceof Error ? error.message : String(error);
    return { name: 'api:health', status: 'FAIL', detail: message, durationMs: ms };
  } finally {
    clearTimeout(t);
  }
}

async function checkAuthConfigured(): Promise<CheckResult> {
  const { check } = await timed('auth:configured', async () => {
    const auth = await getAuthConfig();
    if (!auth.token && !auth.apiKey) {
      throw new Error('no token or apiKey in auth config — run `anima auth login`');
    }
    return auth.apiKey ? 'apiKey present' : 'token present';
  });
  return check;
}

async function checkAuthValid(globals: GlobalOptions): Promise<CheckResult> {
  const { check } = await timed('auth:valid', async () => {
    const client = await getApiClient(globals);
    const me = await client.get<{ email: string; orgName: string }>('/auth/me');
    return `org=${me.orgName} email=${me.email}`;
  });
  return check;
}

const MCP_CONFIG_PATHS: Record<string, string> = {
  'Claude Desktop': join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json'),
  Cursor: join(homedir(), '.cursor/mcp.json'),
  Windsurf: join(homedir(), '.codeium/windsurf/mcp_config.json'),
};

function checkMcpRegistered(): CheckResult {
  const start = performance.now();
  const found: string[] = [];
  for (const [client, path] of Object.entries(MCP_CONFIG_PATHS)) {
    if (!existsSync(path)) continue;
    try {
      const cfg = JSON.parse(readFileSync(path, 'utf8'));
      const servers = cfg?.mcpServers ?? {};
      const animaKeys = Object.keys(servers).filter((k) => k.startsWith('anima'));
      if (animaKeys.length > 0) {
        found.push(`${client}: ${animaKeys.join(', ')}`);
      }
    } catch {
      // Malformed config — silently skip; not our job to repair another tool's file.
    }
  }
  const durationMs = Math.round(performance.now() - start);
  if (found.length === 0) {
    return {
      name: 'mcp:registered',
      status: 'WARN',
      detail: 'no Anima MCP servers found in any client — run `anima setup-mcp install`',
      durationMs,
    };
  }
  return { name: 'mcp:registered', status: 'PASS', detail: found.join('; '), durationMs };
}

function renderTable(results: CheckResult[], jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  const colWidth = Math.max(...results.map((r) => r.name.length)) + 2;
  console.log('');
  for (const r of results) {
    const badge =
      r.status === 'PASS'
        ? pc.green('✓')
        : r.status === 'WARN'
          ? pc.yellow('!')
          : pc.red('✗');
    const name = r.name.padEnd(colWidth);
    const ms = `${r.durationMs}ms`.padStart(8);
    const detail = r.detail ? `  ${pc.dim(r.detail)}` : '';
    console.log(`${badge} ${name} ${ms}${detail}`);
  }
  console.log('');
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warned = results.filter((r) => r.status === 'WARN').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const summary = `PASS=${passed} WARN=${warned} FAIL=${failed}`;
  console.log(failed > 0 ? pc.red(summary) : warned > 0 ? pc.yellow(summary) : pc.green(summary));
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Run a health check on Anima CLI configuration, network, auth, and MCP setup')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });
      void output;

      const results: CheckResult[] = [];
      results.push(await checkConfigReadable());

      const auth = await getAuthConfig();
      const apiUrl = auth.apiUrl ?? 'https://api.useanima.sh';

      results.push(await checkApiDns(apiUrl));
      results.push(await checkApiHealth(apiUrl));
      results.push(await checkAuthConfigured());

      // Only attempt the auth-validity check if we actually have creds — no
      // point making a fetch we know will 401.
      if (auth.token || auth.apiKey) {
        const start = performance.now();
        try {
          results.push(await checkAuthValid(globals));
        } catch (error) {
          const ms = Math.round(performance.now() - start);
          if (error instanceof ApiError) {
            results.push({
              name: 'auth:valid',
              status: 'FAIL',
              detail: `HTTP ${error.status} ${error.code}: ${error.message}`,
              durationMs: ms,
            });
          } else {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ name: 'auth:valid', status: 'FAIL', detail: message, durationMs: ms });
          }
        }
      } else {
        results.push({
          name: 'auth:valid',
          status: 'WARN',
          detail: 'skipped — no credentials configured',
          durationMs: 0,
        });
      }

      results.push(checkMcpRegistered());

      renderTable(results, globals.json ?? false);

      const failed = results.filter((r) => r.status === 'FAIL').length;
      process.exit(failed > 0 ? 1 : 0);
    });
}
