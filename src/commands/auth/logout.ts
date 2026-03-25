import { Command } from 'commander';
import { clearAuthConfig } from '../../lib/config.js';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';

export function logoutCommand(): Command {
  return new Command('logout')
    .description('Clear stored authentication credentials')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      await clearAuthConfig();
      output.success('Logged out successfully');
    });
}
