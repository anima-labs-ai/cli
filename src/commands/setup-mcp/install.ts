import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAuthConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  findClientByName,
  getMcpClients,
  isClientDetected,
  type McpClientDefinition,
  type McpClientName,
} from './clients.js';

type McpInstallMode = 'stdio' | 'remote';

/** Domain MCP servers available for installation */
type McpServerDomain = 'agent' | 'email' | 'phone' | 'cards' | 'vault' | 'platform';

const MCP_SERVER_DOMAINS: McpServerDomain[] = ['agent', 'email', 'phone', 'cards', 'vault', 'platform'];

const REMOTE_URL_BASE = 'https://mcp-{server}-829045119779.us-central1.run.app/mcp';

function getRemoteUrl(server: McpServerDomain): string {
  return REMOTE_URL_BASE.replace('{server}', server);
}

function getPackageName(server: McpServerDomain): string {
  return `@anima-labs/mcp-${server}`;
}

function getServerEntryName(server: McpServerDomain): string {
  return `anima-${server}`;
}

interface InstallOptions {
  client?: string;
  all?: boolean;
  apiKey?: string;
  mode?: McpInstallMode;
  url?: string;
  server?: string;
}

interface McpServerConfigStdio {
  command: string;
  args: string[];
  env: {
    ANIMA_API_KEY: string;
  };
}

/** Claude Desktop remote — uses mcp-remote bridge (no native HTTP support) */
interface McpServerConfigRemoteBridge {
  command: string;
  args: string[];
  env: {
    ANIMA_TOKEN: string;
  };
}

/** Cursor remote — native HTTP via `url` field (no `type` field) */
interface McpServerConfigCursorRemote {
  url: string;
  headers: Record<string, string>;
}

/** Windsurf remote — native HTTP via `serverUrl` field, env var syntax: ${env:VAR} */
interface McpServerConfigWindsurfRemote {
  serverUrl: string;
  headers: Record<string, string>;
}

/** VS Code remote — native HTTP with `type: "http"`, `inputs` for secure secret storage */
interface McpServerConfigVscodeRemote {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

/** Claude Code remote — native HTTP with `type: "http"`, env var syntax: ${VAR} */
interface McpServerConfigClaudeCodeRemote {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

type McpServerConfig =
  | McpServerConfigStdio
  | McpServerConfigRemoteBridge
  | McpServerConfigCursorRemote
  | McpServerConfigWindsurfRemote
  | McpServerConfigVscodeRemote
  | McpServerConfigClaudeCodeRemote;

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, content: Record<string, unknown>): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

function backupFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  copyFileSync(path, `${path}.bak`);
}

function getServerMap(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = config[key];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return {};
  }
  return existing as Record<string, unknown>;
}

function resolveInstallTargets(opts: InstallOptions): McpClientDefinition[] {
  if (opts.client) {
    const client = findClientByName(opts.client);
    if (!client) {
      const names = getMcpClients().map((item) => item.name).join(', ');
      throw new Error(`Invalid client "${opts.client}". Valid values: ${names}`);
    }
    return [client];
  }

  const detected = getMcpClients().filter((client) => isClientDetected(client));

  if (detected.length === 0) {
    throw new Error('No supported MCP clients detected on this machine.');
  }

  if (opts.all) {
    return detected;
  }

  if (detected.length === 1) {
    return detected;
  }

  const promptText = `Detected clients: ${detected.map((client) => client.name).join(', ')}\nChoose clients (comma-separated) or type "all": `;
  const selectedRaw = prompt(promptText)?.trim() ?? '';
  if (!selectedRaw) {
    throw new Error('No client selected. Re-run with --all or --client <name>.');
  }

  if (selectedRaw.toLowerCase() === 'all') {
    return detected;
  }

  const selectedNames = selectedRaw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (selectedNames.length === 0) {
    throw new Error('No client selected. Re-run with --all or --client <name>.');
  }

  const selectedClients: McpClientDefinition[] = [];
  for (const name of selectedNames) {
    const match = detected.find((client) => client.name === name);
    if (!match) {
      const detectedNames = detected.map((client) => client.name).join(', ');
      throw new Error(`Unknown or undetected client "${name}". Detected: ${detectedNames}`);
    }
    selectedClients.push(match);
  }

  return selectedClients;
}

function resolveServerDomains(serverOpt?: string): McpServerDomain[] {
  if (!serverOpt || serverOpt === 'all') {
    return [...MCP_SERVER_DOMAINS];
  }

  const domains = serverOpt.split(',').map((s) => s.trim()) as McpServerDomain[];
  for (const domain of domains) {
    if (!MCP_SERVER_DOMAINS.includes(domain)) {
      throw new Error(
        `Invalid server "${domain}". Valid values: ${MCP_SERVER_DOMAINS.join(', ')}, all`,
      );
    }
  }
  return domains;
}

async function resolveApiKey(override?: string): Promise<string> {
  if (override?.trim()) {
    return override.trim();
  }

  const auth = await getAuthConfig();
  if (auth.apiKey?.trim()) {
    return auth.apiKey.trim();
  }

  const input = prompt('Enter your Anima API key (ak_...):')?.trim() ?? '';
  if (!input) {
    throw new Error('Anima API key is required for MCP setup.');
  }

  return input;
}

function buildMcpServerEntry(
  apiKey: string,
  server: McpServerDomain,
  mode: McpInstallMode = 'stdio',
  url?: string,
  clientName?: McpClientName,
): McpServerConfig {
  if (mode === 'remote') {
    const endpoint = url ?? getRemoteUrl(server);
    return buildRemoteEntry(apiKey, endpoint, clientName);
  }

  return {
    command: 'npx',
    args: ['-y', getPackageName(server)],
    env: {
      ANIMA_API_KEY: apiKey,
    },
  };
}

function buildRemoteEntry(
  apiKey: string,
  endpoint: string,
  clientName?: McpClientName,
): McpServerConfig {
  switch (clientName) {
    case 'cursor':
      return {
        url: endpoint,
        headers: { Authorization: `Bearer ${apiKey}` },
      };

    case 'windsurf':
      return {
        serverUrl: endpoint,
        headers: { Authorization: 'Bearer ${env:ANIMA_API_KEY}' },
      };

    case 'vscode':
      return {
        type: 'http',
        url: endpoint,
        headers: { Authorization: 'Bearer ${input:anima-key}' },
      };

    case 'claude-code':
      return {
        type: 'http',
        url: endpoint,
        headers: { Authorization: 'Bearer ${ANIMA_API_KEY}' },
      };

    case 'claude-desktop':
    case undefined:
      return {
        command: 'npx',
        args: [
          '-y',
          'mcp-remote',
          endpoint,
          '--header',
          'Authorization:${ANIMA_TOKEN}',
        ],
        env: {
          ANIMA_TOKEN: `Bearer ${apiKey}`,
        },
      };
  }
}

function installForClient(
  client: McpClientDefinition,
  apiKey: string,
  servers: McpServerDomain[],
  mode: McpInstallMode = 'stdio',
  url?: string,
): void {
  const config = readJsonFile(client.configPath);
  const serverMap = getServerMap(config, client.serverKey);

  for (const server of servers) {
    const entryName = getServerEntryName(server);
    serverMap[entryName] = buildMcpServerEntry(apiKey, server, mode, url, client.name);
  }

  config[client.serverKey] = serverMap;

  if (client.name === 'vscode' && mode === 'remote') {
    injectVscodeInputs(config);
  }

  backupFile(client.configPath);
  writeJsonFile(client.configPath, config);
}

function injectVscodeInputs(config: Record<string, unknown>): void {
  const inputs = Array.isArray(config.inputs) ? (config.inputs as Array<Record<string, unknown>>) : [];
  const hasInput = inputs.some((input) => input.id === 'anima-key');
  if (!hasInput) {
    inputs.push({
      id: 'anima-key',
      type: 'promptString',
      description: 'Anima API Key',
      password: true,
    });
  }
  config.inputs = inputs;
}

export function installMcpCommand(): Command {
  return new Command('install')
    .description('Install Anima MCP server(s) in supported clients')
    .option('--client <name>', 'Target client')
    .option('--all', 'Configure all detected clients')
    .option('--api-key <key>', 'API key override')
    .option('--mode <mode>', 'Connection mode: stdio (local) or remote (hosted)', 'stdio')
    .option('--url <endpoint>', 'Remote endpoint URL override')
    .option(
      '--server <name>',
      `Domain server(s) to install: ${MCP_SERVER_DOMAINS.join(', ')}, all (default: all)`,
      'all',
    )
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions & InstallOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const mode: McpInstallMode = globals.mode === 'remote' ? 'remote' : 'stdio';

        if (globals.url && mode !== 'remote') {
          throw new Error('--url can only be used with --mode remote');
        }

        const targets = resolveInstallTargets(globals);
        const servers = resolveServerDomains(globals.server);
        const apiKey = await resolveApiKey(globals.apiKey);

        for (const client of targets) {
          installForClient(client, apiKey, servers, mode, globals.url);
        }

        if (globals.json) {
          output.json({
            configured: targets.map((client) => client.name as McpClientName),
            count: targets.length,
            mode,
            servers,
            ...(mode === 'remote' ? { urls: servers.map(getRemoteUrl) } : {}),
          });
          return;
        }

        output.success(
          `Configured ${servers.length} MCP server${servers.length === 1 ? '' : 's'} for ${targets.length} client${targets.length === 1 ? '' : 's'} (${mode} mode).`,
        );
        output.table(
          ['Client', 'Config Path'],
          targets.map((client) => [client.label, client.configPath]),
        );
        output.info(`Servers: ${servers.map((s) => `anima-${s}`).join(', ')}`);

        if (mode === 'remote') {
          output.info(`Remote endpoints: ${servers.map(getRemoteUrl).join(', ')}`);
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
