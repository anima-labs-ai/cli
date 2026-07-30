import { Command } from 'commander';
import { resolveOrgId } from '../../lib/agent.js';
import { requireNonEmptyArg } from '../../lib/args.js';
import type { GlobalOptions } from '../../lib/auth.js';
import { handleOrpcError, requireOrpcAuth } from '../../lib/orpc.js';
import { Output } from '../../lib/output.js';

interface KeyRotateOptions {
  org?: string;
}

export function keyRotateCommand(): Command {
  // Was POST /v1/admin/keys/rotate, a route the API does not have. The real
  // one is POST /orgs/{id}/rotate-key, which mints a new master key and
  // returns it once. Master-gated, as rotating the org's master credential
  // should be.
  return new Command('rotate')
    .description("Rotate the organization's master key")
    // Optional for the same reason as `identity create`: a mandatory option is
    // enforced during parse, so this demanded an org id the config already had.
    .option('--org <org>', 'Organization ID (defaults to your current org)', requireNonEmptyArg('Organization ID'))
    .action(async function (this: Command) {
      const opts = this.opts<KeyRotateOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      // Before the try: a `fatal` inside it would be caught by the API-failure
      // handler, which rewrites the exit code and mislabels missing input.
      const orgId = await resolveOrgId(opts.org, output);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.org.rotateKey({ id: orgId });

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Org', opts.org],
          ['New master key', result.masterKey],
        ]);
        // Shown once and never retrievable again — the org record stores it,
        // but no endpoint reads it back out.
        output.success('Master key rotated. Save it now; it is not shown again.');
      } catch (err: unknown) {
        handleOrpcError(err, output, 'Failed to rotate master key');
      }
    });
}
