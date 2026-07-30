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
        // `/me/orgs` answers "every org this human belongs to", which only a
        // Clerk session or OAuth token can be asked. An API key is scoped to
        // one org, and that org is still a perfectly good answer to "list my
        // orgs" — so ask `/orgs/me` for it rather than making the user go and
        // run a different command. The API's own error says as much
        // ("query /orgs/me instead"); this just does it.
        //
        // Matched on the message, not the code. The API throws
        // `AppError("USER_AUTH_REQUIRED", …, 400)`, but that code does not
        // survive the trip: the client receives ORPCError with
        // `code: "INTERNAL_SERVER_ERROR"` and `status: 400`, so the
        // `err.code === 'USER_AUTH_REQUIRED'` branch that used to live here
        // could never match and every API-key user fell through to the raw
        // server message. Status alone is too broad — a 400 is also what a
        // malformed request returns — so it takes both.
        if (
          err instanceof ORPCError &&
          err.status === 400 &&
          /requires user authentication/i.test(err.message)
        ) {
          try {
            const orpc = await requireOrpcAuth(globals);
            const org = await orpc.org.me({});
            const defaultOrg = await resolveConfigValue('defaultOrg');

            if (globals.json) {
              output.json({ items: [org] });
              return;
            }

            output.table(
              ['ID', 'Name', 'Slug', 'Role', 'Tier', 'Default'],
              [[org.id, org.name, org.slug, '-', org.tier ?? '-', org.id === defaultOrg ? '*' : '']],
              {
                summary:
                  'Scoped to the org this API key belongs to. Sign in with `am auth login` to list every org you are a member of.',
              },
            );
            return;
          } catch (fallbackErr: unknown) {
            output.error(
              `Failed to list orgs: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
            );
            process.exit(1);
          }
        }

        if (err instanceof ORPCError || err instanceof Error) {
          output.error(`Failed to list orgs: ${err.message}`);
        }
        process.exit(1);
      }
    });
}
