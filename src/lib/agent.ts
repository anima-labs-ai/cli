import { resolveConfigValueWithSource, type ConfigSource } from './config.js';
import type { Output } from './output.js';

function describeSource(source: ConfigSource, flag: string): string {
  switch (source.layer) {
    case 'env':
      return source.variable;
    case 'profile':
      return `profile "${source.name}"`;
    case 'config':
      return 'your config';
    case 'flag':
      return flag;
  }
}

/**
 * The agent a command is acting *as* — `--agent` when given, the configured
 * `defaultIdentity` when not.
 *
 * Every one of these commands used to declare `--agent` with
 * `.requiredOption()`, which made the flag mandatory even though `am init` had
 * already written the id to config.json. Commander enforces a mandatory option
 * during parse, so the command failed before its action body could have
 * consulted anything — including the config file sitting right there. That is
 * why the fix had to change the declarations and not just add a fallback here:
 * `am email send`, the command `am init` prints on its way out, could not run
 * as printed.
 *
 * Only for commands where `--agent` means "me". A command naming *another*
 * agent (`a2a send --agent` is a destination) must keep the flag mandatory:
 * silently addressing yourself is worse than an error, because it succeeds.
 *
 * Announces the identity whenever it did not come from the command line, so a
 * send that picks up an agent from a profile you forgot you switched to says
 * so. Explicit `--agent` stays quiet — you just typed it.
 */
export async function resolveAgentId(
  flagValue: string | undefined,
  output: Output,
): Promise<string> {
  const resolved = await resolveConfigValueWithSource('defaultIdentity', flagValue);

  if (resolved === undefined) {
    // Exit 2, the convention for bad input: nothing was attempted, and the
    // remedy is a different command line (or a one-off `config set`).
    output.fatal(
      [
        'No agent specified, and no default agent is configured.',
        '',
        '  Pass one explicitly:   --agent <id>',
        '  Or set a default:      am config set defaultIdentity <id>',
        '',
        "Don't have an agent yet? `am init` creates one and makes it the default.",
      ].join('\n'),
      2,
    );
  }

  if (resolved.source.layer !== 'flag') {
    output.notice(
      `Acting as agent ${resolved.value} (from ${describeSource(resolved.source, '--agent')}).`,
    );
  }

  return resolved.value;
}

/**
 * The org a command acts *in* — `--org` when given, the configured
 * `defaultOrg` when not.
 *
 * The same `.requiredOption()` mistake as `--agent` above, and the same
 * consequence: `am identity create` demanded an org id that `am init` had
 * already written to config.json, and Commander rejected the command during
 * parse before the action body could read it. A user who had just onboarded
 * was told to supply the one value the CLI already knew.
 *
 * Only for commands where `--org` means "the org I am working in". A command
 * that names *another* org keeps the flag mandatory, for the same reason
 * `--agent` does: quietly defaulting to yourself succeeds, and a wrong success
 * is worse than an error.
 *
 * Lives beside `resolveAgentId` because both answer "what scope is this
 * command running in" from the same layered config, and the source-describing
 * helper is shared. The module name is now narrower than its contents.
 */
export async function resolveOrgId(
  flagValue: string | undefined,
  output: Output,
): Promise<string> {
  const resolved = await resolveConfigValueWithSource('defaultOrg', flagValue);

  if (resolved === undefined) {
    // Exit 2, the convention for bad input: nothing was attempted, and the
    // remedy is a different command line (or a one-off `config set`).
    output.fatal(
      [
        'No organization specified, and no default is configured.',
        '',
        '  Pass one explicitly:   --org <id>',
        '  Or set a default:      am config set defaultOrg <id>',
        '',
        'Run `am org list` to see the orgs this credential can reach.',
      ].join('\n'),
      2,
    );
  }

  if (resolved.source.layer !== 'flag') {
    output.notice(
      `Using organization ${resolved.value} (from ${describeSource(resolved.source, '--org')}).`,
    );
  }

  return resolved.value;
}
