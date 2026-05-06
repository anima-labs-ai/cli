import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { requireAuth, type GlobalOptions } from '../../lib/auth.js';
import { ApiError } from '../../lib/api-client.js';

interface CardOptions {
  agent: string;
}

interface AgentCard {
  name: string;
  description?: string;
  url: string;
  did: string;
  capabilities: {
    email: boolean;
    phone: boolean;
    cards: boolean;
    vault: boolean;
    address: boolean;
    protocols: string[];
  };
  verification: {
    level: 'basic' | 'standard' | 'premium';
    credentials: string[];
  };
  trustScore: number;
  contact: {
    email?: string;
    phone?: string;
  };
}

function formatCapabilities(caps: AgentCard['capabilities']): string {
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
        const client = await requireAuth(globals);
        const result = await client.get<AgentCard>(`/v1/agents/${opts.agent}/card`);

        if (globals.json) {
          output.json(result);
          return;
        }

        output.details([
          ['Name', result.name],
          ['DID', result.did],
          ['URL', result.url],
          ['Description', result.description ?? '-'],
          ['Capabilities', formatCapabilities(result.capabilities)],
          ['Verification', result.verification.level],
          ['Credentials', result.verification.credentials.join(', ') || '-'],
          ['Trust score', String(result.trustScore)],
          ['Contact email', result.contact.email ?? '-'],
          ['Contact phone', result.contact.phone ?? '-'],
        ]);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          output.error(`Failed to get agent card: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
