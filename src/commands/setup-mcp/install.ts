import * as clack from '@clack/prompts';
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

/** Hosted MCP gateway — one Bearer-authenticated endpoint serving every domain */
const REMOTE_GATEWAY_URL = 'https://mcp.useanima.sh/mcp';

/**
 * The one published stdio server. The former per-domain split
 * (`@anima-labs/mcp-agent`, `-email`, `-phone`, `-vault`, `-platform`)
 * never shipped to npm — configs referencing those packages can never
 * resolve, which is why stdio installs target this package only.
 */
const STDIO_PACKAGE = '@anima-labs/mcp';

/** Server entry name in client configs; verify/status/uninstall recognize it */
const ENTRY_NAME = 'anima';

interface InstallOptions {
  client?: string;
  all?: boolean;
  apiKey?: string;
  mode?: string;
  url?: string;
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

async function resolveInstallTargets(opts: InstallOptions): Promise<McpClientDefinition[]> {
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

  // `prompt()` was a Bun-only global. The CLI ships as a Node bin, so
  // referencing it threw "prompt is not defined" at runtime. Use clack
  // (already a dependency) for portable interactive input.
  const promptText = `Detected clients: ${detected.map((client) => client.name).join(', ')}\nChoose clients (comma-separated) or type "all":`;
  const response = await clack.text({ message: promptText });
  if (clack.isCancel(response)) {
    throw new Error('Cancelled.');
  }
  const selectedRaw = response.trim();
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

function resolveMode(modeOpt?: string): McpInstallMode {
  if (modeOpt === undefined || modeOpt === 'remote') {
    return 'remote';
  }
  if (modeOpt === 'stdio') {
    return 'stdio';
  }
  throw new Error(`Invalid mode "${modeOpt}". Valid values: remote, stdio`);
}

async function resolveApiKey(override?: string): Promise<string> {
  if (override?.trim()) {
    return override.trim();
  }

  const auth = await getAuthConfig();
  if (auth.apiKey?.trim()) {
    return auth.apiKey.trim();
  }

  const response = await clack.password({ message: 'Enter your Anima API key (ak_...):' });
  if (clack.isCancel(response)) {
    throw new Error('Cancelled.');
  }
  const input = response.trim();
  if (!input) {
    throw new Error('Anima API key is required for MCP setup.');
  }

  return input;
}

function buildStdioEntry(apiKey: string): McpServerConfigStdio {
  return {
    command: 'npx',
    args: ['-y', STDIO_PACKAGE],
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
  mode: McpInstallMode,
  url?: string,
): void {
  const config = readJsonFile(client.configPath);
  const serverMap = getServerMap(config, client.serverKey);

  // One unified entry in both modes: the hosted gateway serves every domain
  // at a single endpoint, and the stdio package registers every tool group.
  serverMap[ENTRY_NAME] =
    mode === 'remote'
      ? buildRemoteEntry(apiKey, url ?? REMOTE_GATEWAY_URL, client.name)
      : buildStdioEntry(apiKey);

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
    .description('Install the Anima MCP server in supported clients')
    .option('--client <name>', 'Target client')
    .option('--all', 'Configure all detected clients')
    .option('--api-key <key>', 'API key override')
    .option(
      '--mode <mode>',
      `Connection mode: remote (hosted gateway) or stdio (local ${STDIO_PACKAGE})`,
      'remote',
    )
    .option('--url <endpoint>', 'Remote endpoint URL override')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions & InstallOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const mode = resolveMode(globals.mode);

        if (globals.url && mode !== 'remote') {
          throw new Error('--url can only be used with --mode remote');
        }

        const targets = await resolveInstallTargets(globals);
        const apiKey = await resolveApiKey(globals.apiKey);

        for (const client of targets) {
          installForClient(client, apiKey, mode, globals.url);
        }

        const endpoint = globals.url ?? REMOTE_GATEWAY_URL;

        if (globals.json) {
          output.json({
            configured: targets.map((client) => client.name as McpClientName),
            count: targets.length,
            mode,
            servers: [ENTRY_NAME],
            ...(mode === 'remote' ? { urls: [endpoint] } : { package: STDIO_PACKAGE }),
          });
          return;
        }

        output.success(
          `Configured the "${ENTRY_NAME}" MCP server for ${targets.length} client${targets.length === 1 ? '' : 's'} (${mode} mode).`,
        );
        output.table(
          ['Client', 'Config Path'],
          targets.map((client) => [client.label, client.configPath]),
        );

        if (mode === 'remote') {
          output.info(`Remote endpoint: ${endpoint}`);
        } else {
          output.info(`Local server package: ${STDIO_PACKAGE} (via npx)`);
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
