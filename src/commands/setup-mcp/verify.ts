import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  getMcpClients,
  type McpClientDefinition,
  type McpClientName,
} from './clients.js';

interface VerifyOptions {
  client?: string;
  all?: boolean;
  ping?: boolean;
}

type VerifyStatus = 'ok' | 'warning' | 'error';

interface VerifyResult {
  client: string;
  status: VerifyStatus;
  mode: 'stdio' | 'remote' | 'unknown';
  issues: string[];
  pingOk?: boolean;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  serverUrl?: string;
  type?: string;
  headers?: Record<string, string>;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** All possible Anima server entry names (legacy + split) */
const ANIMA_SERVER_NAMES = [
  'anima',          // legacy monolith
  'anima-agent',
  'anima-email',
  'anima-phone',
  'anima-cards',
  'anima-vault',
  'anima-platform',
];

function getServerEntry(
  client: McpClientDefinition,
): McpServerEntry | null {
  const config = readJsonFile(client.configPath);
  if (!config) return null;

  const serverMapValue = config[client.serverKey];
  if (
    !serverMapValue ||
    typeof serverMapValue !== 'object' ||
    Array.isArray(serverMapValue)
  ) {
    return null;
  }
  const serverMap = serverMapValue as Record<string, unknown>;
  for (const name of ANIMA_SERVER_NAMES) {
    if (name in serverMap) {
      return serverMap[name] as McpServerEntry;
    }
  }
  return null;
}

function validateEntry(entry: McpServerEntry): {
  mode: 'stdio' | 'remote' | 'unknown';
  issues: string[];
} {
  const issues: string[] = [];

  if (entry.url && typeof entry.url === 'string') {
    if (!entry.url.startsWith('http://') && !entry.url.startsWith('https://')) {
      issues.push(`url "${entry.url}" does not start with http(s)://`);
    }
    return { mode: 'remote', issues };
  }

  if (entry.serverUrl && typeof entry.serverUrl === 'string') {
    if (!entry.serverUrl.startsWith('http://') && !entry.serverUrl.startsWith('https://')) {
      issues.push(`serverUrl "${entry.serverUrl}" does not start with http(s)://`);
    }
    return { mode: 'remote', issues };
  }

  if (!entry.command || typeof entry.command !== 'string') {
    issues.push('missing or invalid "command" field');
    return { mode: 'unknown', issues };
  }

  if (entry.command === 'npx' && entry.args?.includes('mcp-remote')) {
    const mcpRemoteIdx = entry.args.indexOf('mcp-remote');
    if (mcpRemoteIdx < 0 || mcpRemoteIdx + 1 >= entry.args.length) {
      issues.push('mcp-remote specified but missing endpoint URL argument');
    }
    const url = entry.args[mcpRemoteIdx + 1];
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      issues.push(`endpoint URL "${url}" does not start with http(s)://`);
    }
    if (!entry.env?.ANIMA_TOKEN) {
      issues.push('missing ANIMA_TOKEN in env');
    } else if (!entry.env.ANIMA_TOKEN.startsWith('Bearer ')) {
      issues.push('ANIMA_TOKEN must start with "Bearer "');
    }
    if (!entry.args.includes('--header')) {
      issues.push('missing --header arg for Authorization');
    }
    return { mode: 'remote', issues };
  }

  if (entry.command === 'bunx' && entry.args?.includes('@anima/mcp')) {
    if (!entry.env?.ANIMA_API_KEY) {
      issues.push('missing ANIMA_API_KEY in env');
    }
    return { mode: 'stdio', issues };
  }

  if (entry.command === 'npx' && entry.args?.some((a) => a.startsWith('@anima-labs/mcp-'))) {
    if (!entry.env?.ANIMA_API_KEY) {
      issues.push('missing ANIMA_API_KEY in env');
    }
    return { mode: 'stdio', issues };
  }

  issues.push(`unrecognized command "${entry.command}"`);
  return { mode: 'unknown', issues };
}

async function pingEndpoint(url: string): Promise<boolean> {
  try {
    const healthUrl = url.replace(/\/mcp\/?$/, '/mcp/health');
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function resolveVerifyTargets(
  options: VerifyOptions,
): McpClientDefinition[] {
  const clients = getMcpClients();

  if (options.all) {
    return clients.filter(
      (c) => getServerEntry(c) !== null,
    );
  }

  if (options.client) {
    const found = clients.find(
      (c) => c.name === options.client,
    );
    if (!found) {
      const names = clients.map((c) => c.name).join(', ');
      throw new Error(
        `Unknown client "${options.client}". Available: ${names}`,
      );
    }
    return [found];
  }

  const configured = clients.filter(
    (c) => getServerEntry(c) !== null,
  );
  if (configured.length === 0) {
    throw new Error(
      'No configured MCP clients found. Run `anima setup-mcp install` first.',
    );
  }
  return configured;
}

function getRemoteUrl(entry: McpServerEntry): string | null {
  if (entry.url) return entry.url;
  if (entry.serverUrl) return entry.serverUrl;
  if (entry.args?.includes('mcp-remote')) {
    const idx = entry.args.indexOf('mcp-remote');
    if (idx >= 0 && idx + 1 < entry.args.length) {
      return entry.args[idx + 1];
    }
  }
  return null;
}

export function verifyMcpCommand(): Command {
  return new Command('verify')
    .description('Verify Anima MCP configuration for installed clients')
    .option('--client <name>', 'Target client to verify')
    .option('--all', 'Verify all configured clients')
    .option('--ping', 'Ping remote endpoints to check connectivity')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions & VerifyOptions>();
      const output = new Output({
        json: globals.json ?? false,
        debug: globals.debug ?? false,
      });

      try {
        const targets = resolveVerifyTargets(globals);
        const results: VerifyResult[] = [];

        for (const client of targets) {
          const entry = getServerEntry(client);
          if (!entry) {
            results.push({
              client: client.name as McpClientName,
              status: 'error',
              mode: 'unknown',
              issues: ['not configured'],
            });
            continue;
          }

          const { mode, issues } = validateEntry(entry);
          let pingOk: boolean | undefined;

          if (globals.ping && mode === 'remote' && issues.length === 0) {
            const url = getRemoteUrl(entry);
            if (url) {
              pingOk = await pingEndpoint(url);
              if (!pingOk) {
                issues.push(`endpoint ${url} unreachable`);
              }
            }
          }

          const status: VerifyStatus =
            issues.length === 0 ? 'ok' : 'error';

          results.push({
            client: client.name as McpClientName,
            status,
            mode,
            issues,
            ...(pingOk !== undefined ? { pingOk } : {}),
          });
        }

        if (globals.json) {
          output.json({ results });
          return;
        }

        const allOk = results.every((r) => r.status === 'ok');

        output.table(
          ['Client', 'Status', 'Mode', 'Issues'],
          results.map((r) => [
            r.client,
            r.status === 'ok' ? '✓' : '✗',
            r.mode,
            r.issues.length > 0 ? r.issues.join('; ') : '-',
          ]),
        );

        if (allOk) {
          output.success(
            `All ${results.length} client${results.length === 1 ? '' : 's'} verified.`,
          );
        } else {
          const failCount = results.filter(
            (r) => r.status !== 'ok',
          ).length;
          output.error(
            `${failCount} client${failCount === 1 ? '' : 's'} with issues. Run \`anima setup-mcp install\` to fix.`,
          );
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
