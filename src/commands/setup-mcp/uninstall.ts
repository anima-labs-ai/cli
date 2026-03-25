import { Command } from 'commander';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  findClientByName,
  getMcpClients,
  isClientDetected,
  type McpClientDefinition,
} from './clients.js';

interface UninstallOptions {
  client?: string;
  all?: boolean;
}

const ANIMA_SERVER_NAME = 'anima';

function backupFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  copyFileSync(path, `${path}.bak`);
}

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

function writeJsonFile(path: string, content: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

function getServerMap(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = config[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function resolveTargets(opts: UninstallOptions): McpClientDefinition[] {
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
  if (opts.all || detected.length === 1) {
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

  const clients: McpClientDefinition[] = [];
  for (const name of selectedNames) {
    const match = detected.find((client) => client.name === name);
    if (!match) {
      const detectedNames = detected.map((client) => client.name).join(', ');
      throw new Error(`Unknown or undetected client "${name}". Detected: ${detectedNames}`);
    }
    clients.push(match);
  }

  return clients;
}

function uninstallFromClient(client: McpClientDefinition): boolean {
  if (!existsSync(client.configPath)) {
    return false;
  }

  const config = readJsonFile(client.configPath);
  const serverMap = getServerMap(config, client.serverKey);

  if (!(ANIMA_SERVER_NAME in serverMap)) {
    return false;
  }

  delete serverMap[ANIMA_SERVER_NAME];
  config[client.serverKey] = serverMap;

  backupFile(client.configPath);
  writeJsonFile(client.configPath, config);
  return true;
}

export function uninstallMcpCommand(): Command {
  return new Command('uninstall')
    .description('Remove Anima MCP server from supported clients')
    .option('--client <name>', 'Target client')
    .option('--all', 'Uninstall from all detected clients')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions & UninstallOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const targets = resolveTargets(globals);
        const removed = targets.filter((client) => uninstallFromClient(client));

        if (globals.json) {
          output.json({
            removed: removed.map((client) => client.name),
            count: removed.length,
          });
          return;
        }

        if (removed.length === 0) {
          output.warn('No Anima MCP entries were found in selected client configs.');
          return;
        }

        output.success(`Removed Anima MCP from ${removed.length} client${removed.length === 1 ? '' : 's'}.`);
        output.table(
          ['Client', 'Config Path'],
          removed.map((client) => [client.label, client.configPath]),
        );
      } catch (error: unknown) {
        if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
