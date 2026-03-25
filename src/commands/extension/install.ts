import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';

interface InstallOptions {
  force?: boolean;
}

interface ExtensionBridgeConfig {
  installed: boolean;
  extensionDir: string;
  version: string;
  installedAt: string;
}

const EXTENSION_VERSION = '0.1.0';

const MANIFEST = {
  manifest_version: 3,
  name: 'Anima Pay',
  version: EXTENSION_VERSION,
  description: 'Anima payment card autofill for AI agents',
  permissions: ['activeTab', 'storage'],
  background: { service_worker: 'background.js' },
  action: { default_popup: 'popup.html' },
};

const BACKGROUND_JS = "chrome.runtime.onInstalled.addListener(() => { console.log('Anima Pay extension installed'); });\n";

const POPUP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Anima Pay</title>
  </head>
  <body>
    <p>Anima Pay - Extension installed</p>
  </body>
</html>
`;

function getChromeExtensionsPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Extensions');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Extensions');
  }
  return join(home, '.config', 'google-chrome', 'Default', 'Extensions');
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

function writeExtensionFiles(extensionDir: string): void {
  mkdirSync(extensionDir, { recursive: true });
  writeFileSync(join(extensionDir, 'manifest.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  writeFileSync(join(extensionDir, 'background.js'), BACKGROUND_JS);
  writeFileSync(join(extensionDir, 'popup.html'), POPUP_HTML);
}

export function installExtensionCommand(): Command {
  return new Command('install')
    .description('Download and install the Anima Chrome extension')
    .option('--force', 'Overwrite existing installation')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions & InstallOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      const configDir = getConfigDir();
      const extensionDir = join(configDir, 'chrome-extension');
      const bridgeConfigPath = join(configDir, 'extension-config.json');
      const chromeExtensionsPath = getChromeExtensionsPath();

      const existing = readBridgeConfig(bridgeConfigPath);
      if (existing?.installed && !globals.force) {
        output.error('Extension is already installed. Re-run with --force to overwrite.');
        process.exit(1);
      }

      if (!existsSync(chromeExtensionsPath)) {
        output.warn(`Chrome extensions directory not found: ${chromeExtensionsPath}`);
        output.info('Chrome may not be installed yet, but local extension files will still be prepared.');
      }

      writeExtensionFiles(extensionDir);

      const result: ExtensionBridgeConfig = {
        installed: true,
        extensionDir,
        version: EXTENSION_VERSION,
        installedAt: new Date().toISOString(),
      };

      writeFileSync(bridgeConfigPath, `${JSON.stringify(result, null, 2)}\n`);

      if (globals.json) {
        output.json(result);
        return;
      }

      output.success('Anima Chrome extension files installed.');
      output.details([
        ['Installed', 'yes'],
        ['Version', result.version],
        ['Directory', result.extensionDir],
        ['Installed At', result.installedAt],
      ]);
      output.info('Open chrome://extensions in Chrome');
      output.info('Enable Developer mode');
      output.info(`Click "Load unpacked" and select: ${result.extensionDir}`);
    });
}
