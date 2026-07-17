import { Command } from 'commander';
import { type GlobalOptions } from '../../lib/auth.js';
import { getConfig, saveConfig } from '../../lib/config.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';
import { requireNonEmptyArg } from '../../lib/args.js';

export function switchOrgCommand(): Command {
  return new Command('switch')
    .description('Set the default organization for subsequent commands')
    .argument('<orgId>', 'Organization ID or slug to switch to', requireNonEmptyArg('Organization ID'))
    .action(async function (this: Command, orgIdOrSlug: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      // Annotated, not inferred, so a later output.fatal()'s `never` narrows control flow.
      const output: Output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.me.listOrgs({});
        const match = result.items.find(
          (o) => o.id === orgIdOrSlug || o.slug === orgIdOrSlug,
        );
        if (!match) {
          output.fatal(`You are not a member of "${orgIdOrSlug}". Run \`am org list\` to see your orgs.`);
        }

        const cfg = await getConfig();
        cfg.defaultOrg = match.id;
        await saveConfig(cfg);

        output.success(`Default org set to ${match.name} (${match.id}).`);
      } catch (err: unknown) {
        if (err instanceof ORPCError) {
          output.error(`Failed to switch org: ${err.message}`);
        } else if (err instanceof Error) {
          output.error(`Failed to switch org: ${err.message}`);
        }
        process.exit(1);
      }
    });
}
