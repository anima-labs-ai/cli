import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';
import {
  loadAnimaConfig,
  parseSecretRef,
  resolveSecretRefs,
  type SecretRef,
} from '../../lib/secret-ref.js';
import { applyScrub, buildScrubPolicy } from '../../lib/scrubber.js';

interface ExecOptions {
  agent?: string;
  config?: string;
  cred?: string[];
  /** --as maps each --cred credentialId to an env var name; same order as --cred */
  as?: string[];
  /**
   * Commander quirk: `.option('--no-scrub', ...)` produces `{ scrub: boolean }`
   * — the flag toggles a positively-named field, NOT a `noScrub: true` pair.
   * Defaults to true; passing `--no-scrub` flips to false.
   */
  scrub?: boolean;
  dryRun?: boolean;
}

/**
 * `am vault exec [--cred ID --as NAME]... -- <command> [args...]`
 *
 * Resolves SecretRefs from anima.json and/or --cred flags, then spawns a child
 * process with those secrets in its env. Secrets NEVER appear on the parent's
 * stdout/stderr, in process args, or in shell history (we use spawn with argv,
 * not shell=true).
 */
export function execCommand(): Command {
  return new Command('exec')
    .description('Run a command with resolved vault secrets injected into its environment')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--config <path>', 'Path to anima.json (defaults to auto-discovery)')
    .option(
      '--cred <credId>',
      'Credential ID to resolve; repeatable. Pair with --as to map to an env var.',
      (value, previous: string[] = []) => [...previous, value],
    )
    .option(
      '--as <name>',
      'Env var name for the corresponding --cred; repeatable in the same order.',
      (value, previous: string[] = []) => [...previous, value],
    )
    .option('--no-scrub', 'Disable stdout/stderr secret scrubbing (faster, but risky)')
    .option('--dry-run', 'Show which secrets would be resolved without running the command')
    .allowExcessArguments(true)
    .passThroughOptions()
    .action(async function (this: Command) {
      const opts = this.opts<ExecOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      // Everything after `--` becomes argv for the child. Commander gives us
      // positional args via this.args; the user is expected to separate their
      // command with `--` so flags don't get interpreted by us.
      const childArgv = this.args;
      if (!opts.dryRun && childArgv.length === 0) {
        output.error('No command to run. Usage: am vault exec [opts] -- <cmd> [args...]');
        process.exit(2);
      }

      try {
        const client = await requireAuth(globals);

        // 1. Load secrets from anima.json (auto-discover walks up from cwd).
        const { config, configPath } = await loadAnimaConfig();
        const refs: Record<string, SecretRef> = { ...(config.secrets ?? {}) };

        if (configPath) output.debug(`Loaded config: ${configPath}`);

        // 2. Layer on --cred/--as pairs from the command line.
        const credIds = opts.cred ?? [];
        const asNames = opts.as ?? [];
        if (credIds.length !== asNames.length) {
          output.error(`--cred and --as must be paired: got ${credIds.length} creds and ${asNames.length} names`);
          process.exit(2);
        }
        for (let i = 0; i < credIds.length; i++) {
          const envName = asNames[i];
          refs[envName] = parseSecretRef(envName, {
            source: 'anima',
            credentialId: credIds[i],
            field: 'login.password', // default field; override via anima.json for non-login creds
            agentId: opts.agent,
          });
        }

        if (Object.keys(refs).length === 0) {
          output.warn('No secrets to inject. Add them to anima.json or pass --cred/--as.');
        }

        // 3. Resolve. Any failure here aborts before we spawn the child.
        const { values, errors } = await resolveSecretRefs(client, refs);
        if (errors.length > 0) {
          for (const e of errors) output.error(`Failed to resolve ${e.name}: ${e.reason}`);
          output.error('Aborting: refusing to run child with unresolved secrets.');
          process.exit(1);
        }

        output.debug(`Resolved ${Object.keys(values).length} secret(s)`);

        if (opts.dryRun) {
          // Show which env vars would be set (names only, never values).
          if (globals.json) {
            output.json({ resolved: Object.keys(values), configPath });
          } else {
            output.success('Dry run — would set:');
            for (const name of Object.keys(values)) output.info(`  ${name}`);
          }
          return;
        }

        // 4. Spawn child with the combined env. Child inherits parent's env
        //    PLUS the resolved secrets — so $PATH, $HOME, etc. still work.
        const childEnv = { ...process.env, ...values };
        const [command, ...args] = childArgv;

        // opts.scrub defaults to true; `--no-scrub` flips it to false. buildScrubPolicy
        // takes a "noScrub" boolean, so invert: noScrub = !(scrub ?? true).
        const scrubPolicy = buildScrubPolicy(values, !(opts.scrub ?? true));

        const child = spawn(command, args, {
          env: childEnv,
          stdio: ['inherit', 'pipe', 'pipe'],
          shell: false, // never shell=true — we use argv directly to avoid injection
        });

        child.stdout.on('data', (chunk: Buffer) => {
          process.stdout.write(applyScrub(chunk, scrubPolicy));
        });
        child.stderr.on('data', (chunk: Buffer) => {
          process.stderr.write(applyScrub(chunk, scrubPolicy));
        });

        child.on('error', (err) => {
          output.error(`Failed to spawn: ${err.message}`);
          process.exit(127);
        });

        child.on('exit', (code, signal) => {
          if (signal) process.kill(process.pid, signal);
          else process.exit(code ?? 0);
        });

        // Forward parent signals to the child so Ctrl-C works.
        for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
          process.on(sig, () => child.kill(sig));
        }
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`vault exec failed: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(`vault exec failed: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
