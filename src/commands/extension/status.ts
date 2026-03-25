import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';

interface ExtensionBridgeConfig {
  installed: boolean;
  extensionDir: string;
  version: string;
  installedAt: string;
}

interface ExtensionStatusResult {
  installed: boolean;
  version?: string;
  directory?: string;
  installedAt?: string;
}

function readBridgeConfig(path: string): ExtensionBridgeConfig | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ExtensionBridgeConfig>;
    if (
      typeof parsed.installed === 'boolean' &&
      typeof parsed.extensionDir === 'string' &&
      typeof parsed.version === 'string' &&
      typeof parsed.installedAt === 'string'
    ) {
      return {
        installed: parsed.installed,
        extensionDir: parsed.extensionDir,
        version: parsed.version,
        installedAt: parsed.installedAt,
      };
    }
  } catch {
  }
  return null;
}

export function extensionStatusCommand(): Command {
  return new Command('status')
    .description('Show extension installation status')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const configDir = getConfigDir();
      const bridgeConfigPath = join(configDir, 'extension-config.json');
      const bridgeConfig = readBridgeConfig(bridgeConfigPath);

      let result: ExtensionStatusResult;

      if (!bridgeConfig || !bridgeConfig.installed || !existsSync(bridgeConfig.extensionDir)) {
        result = { installed: false };
      } else {
        result = {
          installed: true,
          version: bridgeConfig.version,
          directory: bridgeConfig.extensionDir,
          installedAt: bridgeConfig.installedAt,
        };
      }

      if (globals.json) {
        output.json(result);
        return;
      }

      if (!result.installed) {
        output.warn('Anima Chrome extension is not installed.');
        output.details([
          ['Installed', 'no'],
          ['Version', undefined],
          ['Directory', undefined],
          ['Installed At', undefined],
        ]);
        return;
      }

      output.success('Anima Chrome extension is installed.');
      output.details([
        ['Installed', 'yes'],
        ['Version', result.version],
        ['Directory', result.directory],
        ['Installed At', result.installedAt],
      ]);
    });
}
