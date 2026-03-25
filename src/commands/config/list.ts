import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  getConfig,
  listProfiles,
  resolveConfigValue,
  getValidConfigKeys,
  getConfigDir,
  type ProfileConfig,
} from '../../lib/config.js';

export function configListCommand(): Command {
  return new Command('list')
    .description('List all configuration values and profiles')
    .option('--profiles', 'Show only profiles')
    .option('--resolved', 'Show resolved values (with precedence applied)')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions & { profiles?: boolean; resolved?: boolean }>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      if (globals.profiles) {
        const profiles = await listProfiles();
        if (profiles.length === 0) {
          output.warn('No profiles configured');
          return;
        }

        if (globals.json) {
          output.json(profiles);
          return;
        }

        output.table(
          ['Name', 'Active', 'API URL', 'Default Org', 'Output Format'],
          profiles.map((p) => [
            p.name,
            p.active ? '✓' : '',
            p.config.apiUrl ?? '',
            p.config.defaultOrg ?? '',
            p.config.outputFormat ?? '',
          ]),
        );
        return;
      }

      if (globals.resolved) {
        const keys = getValidConfigKeys();
        const resolved: Record<string, string | undefined> = {};
        for (const key of keys) {
          resolved[key] = await resolveConfigValue(key as keyof ProfileConfig);
        }

        if (globals.json) {
          output.json(resolved);
          return;
        }

        output.table(
          ['Key', 'Value'],
          Object.entries(resolved).map(([k, v]) => [k, v ?? '(not set)']),
        );
        return;
      }

      const config = await getConfig();

      if (globals.json) {
        output.json(config);
        return;
      }

      output.details([
        ['Config directory', getConfigDir()],
        ['Default org', config.defaultOrg ?? '(not set)'],
        ['Default identity', config.defaultIdentity ?? '(not set)'],
        ['Output format', config.outputFormat ?? '(not set)'],
        ['Active profile', config.activeProfile ?? '(none)'],
        ['Profiles', config.profiles ? Object.keys(config.profiles).join(', ') : '(none)'],
      ]);
    });
}
