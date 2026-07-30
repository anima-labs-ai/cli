import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';
import {
  clearActiveProfile,
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
        const output = Output.fromGlobals(globals);

        try {
          await setActiveProfile(name);
          output.success(`Switched to profile "${name}"`);
        } catch (err: unknown) {
          output.fatal(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  cmd.addCommand(
    new Command('clear')
      .description('Stop using any profile and fall back to your top-level config')
      .action(async function (this: Command) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = Output.fromGlobals(globals);

        // There was no way back. `use` requires a profile that exists, and
        // "normal" is not a profile called `default` — it is `activeProfile`
        // being unset, which only `delete` produced, and only by destroying
        // the profile. `am auth elevate` consequently signed off with
        // `am config profile use default`, a command that always failed.
        const active = await getActiveProfile();
        if (!active) {
          output.success('No profile was active — already using your top-level config.');
          return;
        }

        try {
          await clearActiveProfile();
          // Named, because the point of the command is usually "get me off
          // whatever elevate switched me to" and the answer is worth seeing.
          output.success(`Stopped using profile "${active.name}". Now on your top-level config.`);
        } catch (err: unknown) {
          output.fatal(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  cmd.addCommand(
    new Command('delete')
      .description('Delete a named profile')
      .argument('<name>', 'Profile name to delete')
      .action(async function (this: Command, name: string) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = Output.fromGlobals(globals);

        try {
          await deleteProfile(name);
          output.success(`Deleted profile "${name}"`);
        } catch (err: unknown) {
          output.fatal(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  cmd.addCommand(
    new Command('list')
      .description('List all profiles')
      .action(async function (this: Command) {
        const globals = this.optsWithGlobals<GlobalOptions>();
        const output = Output.fromGlobals(globals);

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
        const output = Output.fromGlobals(globals);

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
