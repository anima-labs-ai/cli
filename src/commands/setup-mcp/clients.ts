import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';

export type McpClientName =
  | 'claude-desktop'
  | 'cursor'
  | 'windsurf'
  | 'vscode'
  | 'claude-code';

export type McpServerKey = 'mcpServers' | 'servers' | 'context_servers';

export interface McpClientDefinition {
  name: McpClientName;
  label: string;
  configPath: string;
  serverKey: McpServerKey;
  detectionPath: string;
}

function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}

function getAppDataDir(): string {
  return process.env.APPDATA ?? join(getHomeDir(), 'AppData', 'Roaming');
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function isMac(): boolean {
  return process.platform === 'darwin';
}

export function getMcpClients(): McpClientDefinition[] {
  const home = getHomeDir();
  const appData = getAppDataDir();

  const claudeDesktopPath = isWindows()
    ? join(appData, 'Claude', 'claude_desktop_config.json')
    : isMac()
      ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : join(home, '.config', 'Claude', 'claude_desktop_config.json');

  const cursorPath = isWindows()
    ? join(home, '.cursor', 'mcp.json')
    : join(home, '.cursor', 'mcp.json');

  const windsurfPath = isWindows()
    ? join(appData, 'WindSurf', 'mcp_config.json')
    : join(home, '.codeium', 'windsurf', 'mcp_config.json');

  const vscodePath = isWindows()
    ? join(appData, 'Code', 'User', 'mcp.json')
    : isMac()
      ? join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      : join(home, '.config', 'Code', 'User', 'mcp.json');

  const claudeCodePath = join(home, '.claude.json');

  return [
    {
      name: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: claudeDesktopPath,
      serverKey: 'mcpServers',
      detectionPath: dirname(claudeDesktopPath),
    },
    {
      name: 'cursor',
      label: 'Cursor',
      configPath: cursorPath,
      serverKey: 'mcpServers',
      detectionPath: dirname(cursorPath),
    },
    {
      name: 'windsurf',
      label: 'Windsurf',
      configPath: windsurfPath,
      serverKey: 'mcpServers',
      detectionPath: dirname(windsurfPath),
    },
    {
      name: 'vscode',
      label: 'VS Code',
      configPath: vscodePath,
      serverKey: 'servers',
      detectionPath: dirname(vscodePath),
    },
    {
      name: 'claude-code',
      label: 'Claude Code',
      configPath: claudeCodePath,
      serverKey: 'mcpServers',
      detectionPath: claudeCodePath,
    },
  ];
}

export function isClientDetected(client: McpClientDefinition): boolean {
  return existsSync(client.detectionPath);
}

export function findClientByName(name: string): McpClientDefinition | undefined {
  return getMcpClients().find((client) => client.name === name);
}
