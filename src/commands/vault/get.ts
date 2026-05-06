import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface GetOptions {
  agent?: string;
  unmask?: boolean;
}

function redactValue(value: string | undefined): string | undefined {
  if (!value) return value;
  return '****';
}

function redactCardNumber(value: string | undefined): string | undefined {
  if (!value) return value;
  return '****' + value.slice(-4);
}

export function getCommand(): Command {
  return new Command('get')
    .description('Get credential by ID')
    .argument('<credentialId>', 'Credential ID')
    .option('--agent <id>', 'Agent ID (optional with agent API key)')
    .option('--unmask', 'Show raw credential values (passwords, tokens). Use with caution.')
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<GetOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);
      const mask = !opts.unmask;

      if (opts.unmask) {
        output.warn('Displaying unmasked credentials. Do not share this output.');
      }

      try {
        // The server masks by default. Pass reveal=true to get plaintext,
        // which requires a master key (mk_) — agent keys will get a 403.
        // This enforces defense-in-depth: the CLI is no longer the only
        // layer of protection. If someone hacks the CLI, they still can't
        // exfiltrate passwords without master-key auth.
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.get({
          id: credentialId,
          agentId: opts.agent,
          reveal: opts.unmask ?? false,
        });

        if (globals.json) {
          if (mask) {
            // Redact sensitive fields in JSON output
            const masked = { ...result };
            if (masked.login) {
              masked.login = { ...masked.login };
              if (masked.login.password) masked.login.password = '****';
              if (masked.login.totp) masked.login.totp = '****';
            }
            if (masked.card) {
              masked.card = { ...masked.card };
              if (masked.card.code) masked.card.code = '****';
              if (masked.card.number) masked.card.number = '****' + masked.card.number.slice(-4);
            }
            if (masked.identity) {
              masked.identity = { ...masked.identity };
              if (masked.identity.ssn) masked.identity.ssn = '****';
            }
            output.json(masked);
          } else {
            output.json(result);
          }
          return;
        }

        const password = mask ? redactValue(result.login?.password) : result.login?.password;
        const cardNumber = mask ? redactCardNumber(result.card?.number) : result.card?.number;
        const cardCode = mask ? redactValue(result.card?.code) : result.card?.code;
        const ssn = mask ? redactValue(result.identity?.ssn) : result.identity?.ssn;

        output.details([
          ['Credential ID', result.id],
          ['Type', result.type],
          ['Name', result.name],
          ['Username', result.login?.username],
          ['Password', password],
          ['URI', result.login?.uris?.[0]?.uri],
          ['Card Number', cardNumber],
          ['Card Code', cardCode],
          ['SSN', ssn],
          ['Favorite', result.favorite ? 'Yes' : 'No'],
          ['Updated At', result.updatedAt],
        ]);

        if (mask) {
          output.info('Sensitive fields masked. Use --unmask to reveal.');
        }
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 403) {
            output.error('Forbidden: --unmask requires a master key. Agent keys cannot reveal plaintext.');
          } else if (error.status === 404) {
            output.error('Credential not found.');
          } else {
            output.error(`Failed to get credential: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(`Failed to get credential: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
