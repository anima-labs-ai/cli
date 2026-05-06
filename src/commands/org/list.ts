import { Command } from 'commander';
import { type GlobalOptions } from '../../lib/auth.js';
import { resolveConfigValue } from '../../lib/config.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

export function listOrgsCommand(): Command {
  return new Command('list')
    .description('List organizations you are a member of')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.me.listOrgs({});
        const defaultOrg = await resolveConfigValue('defaultOrg');

        if (globals.json) {
          output.json(result);
          return;
        }

        output.table(
          ['ID', 'Name', 'Slug', 'Role', 'Tier', 'Default'],
          result.items.map((o) => [
            o.id,
            o.name,
            o.slug,
            o.role,
            o.tier ?? '-',
            o.id === defaultOrg ? '*' : '',
          ]),
          {
            summary: `You are a member of ${result.items.length} org(s).`,
          },
        );
      } catch (err: unknown) {
        if (err instanceof ORPCError) {
          if (err.code === 'USER_AUTH_REQUIRED') {
            output.error(
              'This command requires user authentication. API keys are scoped to a single org — run `am whoami` to see it.',
            );
          } else {
            output.error(`Failed to list orgs: ${err.message}`);
          }
        } else if (err instanceof Error) {
          output.error(`Failed to list orgs: ${err.message}`);
        }
        process.exit(1);
      }
    });
}
