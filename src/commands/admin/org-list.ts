import { Command } from 'commander';
import type { GlobalOptions } from '../../lib/auth.js';
import { resolveConfigValue } from '../../lib/config.js';
import { handleOrpcError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

/**
 * `am admin org list`.
 *
 * Was `GET /v1/admin/orgs`, which answered "Route not found" — the whole
 * `/v1/admin/*` namespace this command family was written against no longer
 * exists in the API, so every call 404'd rather than failing on permissions.
 * The org the caller is authenticated for now comes from `/orgs/me`, the same
 * endpoint `am org list` falls back to for an API key.
 */
export function orgListCommand(): Command {
  return new Command('list')
    .description('List organizations')
    .action(async function (this: Command) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const org = await orpc.org.me({});
        const defaultOrg = await resolveConfigValue('defaultOrg');

        if (output.isMachineFormat()) {
          output.json({ items: [org] });
          return;
        }

        output.table(
          ['ID', 'Name', 'Slug', 'Tier', 'Default'],
          [[org.id, org.name, org.slug, org.tier ?? '-', org.id === defaultOrg ? '*' : '']],
          {
            summary:
              'Scoped to the org this credential belongs to. Sign in with `am auth login` to see every org you are a member of.',
          },
        );
      } catch (err: unknown) {
        handleOrpcError(err, output, 'Failed to list organizations');
      }
    });
}
