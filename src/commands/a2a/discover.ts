import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import type { GlobalOptions } from '../../lib/auth.js';

interface DiscoverOptions {
  // no extra options; URL is the argument
}

export function discoverCommand(): Command {
  return new Command('discover')
    .description('Discover an agent\'s capabilities via its Agent Card')
    .argument('<url>', 'Agent public URL (e.g. https://agent.example.com)')
    .action(async function (this: Command, url: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = new Output({ json: globals.json ?? false, debug: globals.debug ?? false });

      try {
        const cardUrl = new URL('/.well-known/agent.json', url);
        const res = await fetch(cardUrl.toString());

        if (!res.ok) {
          output.error(`Failed to fetch agent card: ${res.status} ${res.statusText}`);
          process.exit(1);
        }

        const card = await res.json() as Record<string, unknown>;

        if (globals.json) {
          output.json(card);
          return;
        }

        output.success('Agent Card discovered:');
        output.info(JSON.stringify(card, null, 2));
      } catch (error: unknown) {
        if (error instanceof Error) {
          output.error(`Failed to discover agent: ${error.message}`);
        }
        process.exit(1);
      }
    });
}
