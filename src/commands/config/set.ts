import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  getConfig,
  saveConfig,
  isValidConfigKey,
  getValidConfigKeys,
  type ProfileConfig,
} from '../../lib/config.js';

export function configSetCommand(): Command {
  return new Command('set')
    .description('Set a configuration value')
    .argument('<key>', `Config key (${getValidConfigKeys().join(', ')})`)
    .argument('<value>', 'Value to set')
    .option('-p, --profile <name>', 'Set value in a named profile')
    .action(async function (this: Command, key: string, value: string) {
      const globals = this.optsWithGlobals<GlobalOptions & { profile?: string }>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if (!isValidConfigKey(key)) {
        output.error(`Invalid config key "${key}". Valid keys: ${getValidConfigKeys().join(', ')}`);
        return;
      }

      const config = await getConfig();
      const profileName = globals.profile;

      if (profileName) {
        if (!config.profiles) config.profiles = {};
        if (!config.profiles[profileName]) config.profiles[profileName] = {};
        config.profiles[profileName][key as keyof ProfileConfig] = value as never;
        await saveConfig(config);
        output.success(`Set ${key} = "${value}" in profile "${profileName}"`);
      } else {
        (config as Record<string, unknown>)[key] = value;
        await saveConfig(config);
        output.success(`Set ${key} = "${value}"`);
      }
    });
}
