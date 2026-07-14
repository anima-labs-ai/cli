import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface GetOptions {
  agent?: string;
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
    .action(async function (this: Command, credentialId: string) {
      const opts = this.opts<GetOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        // The CLI never reveals plaintext. It cannot even ask: `reveal` is
        // never sent, so the server masks secret fields, and the client
        // re-masks as defense-in-depth. To view a secret, a human uses the
        // Anima console, where reveal is audited and step-up gated.
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.vault.get({
          id: credentialId,
          agentId: opts.agent,
        });

        if (globals.json) {
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
          return;
        }

        output.details([
          ['Credential ID', result.id],
          ['Type', result.type],
          ['Name', result.name],
          ['Username', result.login?.username],
          ['Password', redactValue(result.login?.password)],
          ['URI', result.login?.uris?.[0]?.uri],
          ['Card Number', redactCardNumber(result.card?.number)],
          ['Card Code', redactValue(result.card?.code)],
          ['SSN', redactValue(result.identity?.ssn)],
          ['Favorite', result.favorite ? 'Yes' : 'No'],
          ['Updated At', result.updatedAt],
        ]);

        output.info('Sensitive fields are masked. Reveal is available (audited) in the Anima console.');
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 401) {
            output.error('Not authenticated. Run `anima auth login` to authenticate.');
          } else if (error.status === 403) {
            output.error('Forbidden: you do not have access to this credential.');
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
