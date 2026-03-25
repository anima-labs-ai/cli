import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  setActiveProfile,
  deleteProfile,
  listProfiles,
  getActiveProfile,
} from '../../lib/config.js';

export function configProfileCommand(): Command {
  const cmd = new Command('profile')
    .description('Manage configuration profiles');

  cmd.addCommand(
    new Command('use')
      .description('Switch to a named profile')
      .argument('<name>', 'Profile name to activate')
      .action(async function (this: Command, name: string) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

        try {
          await setActiveProfile(name);
          output.success(`Switched to profile "${name}"`);
        } catch (err: unknown) {
          output.error(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  cmd.addCommand(
    new Command('delete')
      .description('Delete a named profile')
      .argument('<name>', 'Profile name to delete')
      .action(async function (this: Command, name: string) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

        try {
          await deleteProfile(name);
          output.success(`Deleted profile "${name}"`);
        } catch (err: unknown) {
          output.error(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  cmd.addCommand(
    new Command('list')
      .description('List all profiles')
      .action(async function (this: Command) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

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
      }),
  );

  cmd.addCommand(
    new Command('current')
      .description('Show the active profile')
      .action(async function (this: Command) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

        const active = await getActiveProfile();

        if (!active) {
          output.warn('No active profile');
          return;
        }

        if (globals.json) {
          output.json(active);
          return;
        }

        output.details([
          ['API URL', active.config.apiUrl ?? '(not set)'],
          ['API Key', active.config.apiKey ? `****${active.config.apiKey.slice(-4)}` : '(not set)'],
          ['Default org', active.config.defaultOrg ?? '(not set)'],
          ['Default identity', active.config.defaultIdentity ?? '(not set)'],
          ['Output format', active.config.outputFormat ?? '(not set)'],
        ]);
      }),
  );

  return cmd;
}
