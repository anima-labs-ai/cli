import { Command } from 'commander';
import { requireNonEmptyArg } from '../../lib/args.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { getConfig, saveConfig } from '../../lib/config.js';
import { handleOrpcError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

/**
 * `am identity use <id>` — the agent-level twin of `am org switch`.
 *
 * Every command now resolves `--agent` from `defaultIdentity`, which made that
 * value the single most consequential thing in the config: it decides which
 * agent a send comes from. Changing it still meant knowing it was a config key
 * and typing `am config set defaultIdentity <id>` — a generic setter, with no
 * check that the id names an agent you can actually act as, and no symmetry
 * with the org command sitting right next to it.
 *
 * Validated against the org's agents before it is written, so a typo becomes
 * an error here rather than a confusing 403 on the next send.
 */
export function useIdentityCommand(): Command {
  return new Command('use')
    .description('Set the default agent for subsequent commands')
    .argument('<id>', 'Agent ID or slug to act as', requireNonEmptyArg('Agent ID'))
    .action(async function (this: Command, idOrSlug: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      // Annotated, not inferred, so a later output.fatal()'s `never` narrows control flow.
      const output: Output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.agent.list({});
        const match = result.items.find((a) => a.id === idOrSlug || a.slug === idOrSlug);

        if (!match) {
          output.fatal(
            `No agent "${idOrSlug}" in this organization. Run \`am identity list\` to see them.`,
          );
        }

        const cfg = await getConfig();
        cfg.defaultIdentity = match.id;
        await saveConfig(cfg);

        output.success(`Now acting as ${match.name} (${match.id}).`);
      } catch (err: unknown) {
        handleOrpcError(err, output, 'Failed to switch agent');
      }
    });
}
