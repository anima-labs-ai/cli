import { Command } from 'commander';
import { installMcpCommand } from './install.js';
import { uninstallMcpCommand } from './uninstall.js';
import { statusMcpCommand } from './status.js';
import { verifyMcpCommand } from './verify.js';

export function setupMcpCommands(): Command {
  const cmd = new Command('setup-mcp').description('Configure MCP server for AI clients');

  cmd.addCommand(installMcpCommand());
  cmd.addCommand(uninstallMcpCommand());
  cmd.addCommand(statusMcpCommand());
  cmd.addCommand(verifyMcpCommand());

  return cmd;
}
