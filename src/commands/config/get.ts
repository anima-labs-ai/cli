import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  getConfig,
  isValidConfigKey,
  getValidConfigKeys,
  resolveConfigValue,
  type ProfileConfig,
} from '../../lib/config.js';

export function configGetCommand(): Command {
  return new Command('get')
    .description('Get a configuration value (resolved with precedence)')
    .argument('<key>', `Config key (${getValidConfigKeys().join(', ')})`)
    .option('-p, --profile <name>', 'Get value from a specific profile (skip precedence)')
    .action(async function (this: Command, key: string) {
      const globals = this.optsWithGlobals<GlobalOptions & { profile?: string }>();
      const output = Output.fromGlobals(globals);

      if (!isValidConfigKey(key)) {
        output.fatal(`Invalid config key "${key}". Valid keys: ${getValidConfigKeys().join(', ')}`, 2);
      }

      const profileName = globals.profile;

      if (profileName) {
        const config = await getConfig();
        const profileVal = config.profiles?.[profileName]?.[key as keyof ProfileConfig];
        if (profileVal !== undefined) {
          if (globals.json) {
            output.json({ key, value: profileVal, profile: profileName });
            return;
          }
          console.log(profileVal);
        } else {
          output.fatal(`Key "${key}" not set in profile "${profileName}"`);
        }
        return;
      }

      const resolved = await resolveConfigValue(key as keyof ProfileConfig);
      if (resolved !== undefined) {
        if (globals.json) {
          output.json({ key, value: resolved });
          return;
        }
        console.log(resolved);
      } else {
        output.fatal(`Key "${key}" is not set`);
      }
    });
}
