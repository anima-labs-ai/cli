import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface CardOptions {
  agent: string;
}

interface AgentCardCapabilities {
  email: boolean;
  phone: boolean;
  cards: boolean;
  vault: boolean;
  address: boolean;
  protocols: string[];
}

function formatCapabilities(caps: AgentCardCapabilities): string {
  const enabled: string[] = [];
  if (caps.email) enabled.push('email');
  if (caps.phone) enabled.push('phone');
  if (caps.cards) enabled.push('cards');
  if (caps.vault) enabled.push('vault');
  if (caps.address) enabled.push('address');
  enabled.push(...caps.protocols);
  return enabled.join(', ') || '-';
}

export function getAgentCardCommand(): Command {
  return new Command('card')
    .description('Get the public agent card')
    .requiredOption('--agent <id>', 'Agent ID')
    .action(async function (this: Command) {
      const opts = this.opts<CardOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const card = await orpc.identity.getAgentCard({ agentId: opts.agent });

        if (globals.json) {
          output.json(card);
          return;
        }

        output.details([
          ['Name', card.name],
          ['DID', card.did],
          ['URL', card.url],
          ['Description', card.description ?? '-'],
          ['Capabilities', formatCapabilities(card.capabilities)],
          ['Verification', card.verification.level],
          ['Credentials', card.verification.credentials.join(', ') || '-'],
          ['Trust score', String(card.trustScore)],
          ['Contact email', card.contact.email ?? '-'],
          ['Contact phone', card.contact.phone ?? '-'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          if (error.status === 404) {
            output.error('Agent card not found.');
          } else {
            output.error(`Failed to get agent card: ${error.message}`);
          }
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
