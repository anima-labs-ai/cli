import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface VoiceCatalogOptions {
  tier?: 'basic' | 'premium';
  gender?: 'male' | 'female' | 'neutral';
  language?: string;
}

export function voiceCatalogCommand(): Command {
  return new Command('catalog')
    .description('List available voices for AI agent calls')
    .option('--tier <tier>', 'Filter by tier (basic or premium)')
    .option('--gender <gender>', 'Filter by gender (male, female, neutral)')
    .option('--language <lang>', 'Filter by language code (e.g. en, en-US, fr-FR)')
    .action(async function (this: Command) {
      const opts = this.opts<VoiceCatalogOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const response = await orpc.voice.catalog({
          gender: opts.gender,
          language: opts.language,
        });

        if (output.isMachineFormat()) {
          output.json(response);
          return;
        }

        const voices = response.voices;
        const summary = voices.length === 0
          ? 'No voices found matching filters'
          : `${voices.length} voice(s) found`;
        output.table(
          ['ID', 'Name', 'Gender', 'Language', 'Accent', 'Age', 'Sounds like'],
          voices.map((v) => [
            v.id,
            v.name,
            v.gender,
            v.language,
            v.accent ?? '-',
            v.age ?? '-',
            v.descriptors.length > 0 ? v.descriptors.join(', ') : '-',
          ]),
          { summary },
        );
      } catch (error: unknown) {
        if (error instanceof ORPCError) {
          output.error(`Failed to list voices: ${error.message}`);
        } else if (error instanceof Error) {
          output.error(error.message);
        }
        process.exit(1);
      }
    });
}
