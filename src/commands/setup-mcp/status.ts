import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { getMcpClients, type McpClientDefinition } from './clients.js';

type McpMode = 'stdio' | 'remote' | 'unknown';

interface StatusRow {
  client: string;
  configured: boolean;
  detected: boolean;
  mode: McpMode;
  url: string | null;
  path: string;
  servers: string[];
}

const ANIMA_SERVER_NAMES = [
  'anima',          // legacy monolith
  'anima-agent',
  'anima-email',
  'anima-phone',
  'anima-cards',
  'anima-vault',
  'anima-platform',
];

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
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

function getAnimaEntries(client: McpClientDefinition): { entry: McpServerEntry; name: string }[] {
  if (!existsSync(client.configPath)) {
    return [];
  }
  const config = readJsonFile(client.configPath);
  const serverMapValue = config[client.serverKey];
  if (!serverMapValue || typeof serverMapValue !== 'object' || Array.isArray(serverMapValue)) {
    return [];
  }
  const serverMap = serverMapValue as Record<string, unknown>;
  const entries: { entry: McpServerEntry; name: string }[] = [];
  for (const name of ANIMA_SERVER_NAMES) {
    if (name in serverMap) {
      entries.push({ entry: serverMap[name] as McpServerEntry, name });
    }
  }
  return entries;
}

function detectMode(entry: McpServerEntry | null): { mode: McpMode; url: string | null } {
  if (!entry) {
    return { mode: 'unknown', url: null };
  }

  if (entry.url) {
    return { mode: 'remote', url: entry.url };
  }

  if (entry.serverUrl) {
    return { mode: 'remote', url: entry.serverUrl };
  }

  if (entry.command === 'npx' && entry.args?.includes('mcp-remote')) {
    const urlIndex = entry.args.indexOf('mcp-remote');
    const url = urlIndex >= 0 && urlIndex + 1 < entry.args.length ? entry.args[urlIndex + 1] : null;
    return { mode: 'remote', url: url ?? null };
  }

  if (entry.command === 'bunx' || entry.command === 'npx') {
    return { mode: 'stdio', url: null };
  }

  return { mode: 'unknown', url: null };
}

function isDetected(client: McpClientDefinition): boolean {
  if (client.name === 'claude-code') {
    return existsSync(client.configPath);
  }
  return existsSync(client.configPath) || existsSync(client.detectionPath);
}

export function statusMcpCommand(): Command {
  return new Command('status')
    .description('Show Anima MCP setup status across clients')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const rows: StatusRow[] = getMcpClients().map((client) => {
        const entries = getAnimaEntries(client);
        const firstEntry = entries.length > 0 ? entries[0].entry : null;
        const { mode, url } = detectMode(firstEntry);
        return {
          client: client.label,
          configured: entries.length > 0,
          detected: isDetected(client),
          mode: entries.length > 0 ? mode : 'unknown',
          url,
          path: client.configPath,
          servers: entries.map((e) => e.name),
        };
      });

      if (globals.json) {
        output.json({ clients: rows });
        return;
      }

      output.table(
        ['Client', 'Detected', 'Configured', 'Mode', 'Servers', 'Config Path'],
        rows.map((row) => [
          row.client,
          row.detected ? 'yes' : 'no',
          row.configured ? 'yes' : 'no',
          row.configured ? row.mode : '-',
          row.servers.length > 0 ? row.servers.join(', ') : '-',
          row.path,
        ]),
      );
    });
}
