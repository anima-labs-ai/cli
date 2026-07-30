import { Command } from 'commander';
import { Output } from '../../lib/output.js';
import { type GlobalOptions } from '../../lib/auth.js';
import { ORPCError, requireOrpcAuth } from '../../lib/orpc.js';

interface VoiceCatalogOptions {
  gender?: 'male' | 'female' | 'neutral';
  language?: string;
}

export function voiceCatalogCommand(): Command {
  return new Command('voices')
    .description('List available voices for AI agent phone calls')
    .option('--gender <gender>', 'Filter by gender (male, female, neutral)')
    .option('--language <lang>', 'Filter by language code (e.g. en, en-US, fr-FR)')
    .action(async function (this: Command) {
      const opts = this.opts<VoiceCatalogOptions>();
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);

        const input: {
          gender?: 'male' | 'female' | 'neutral';
          language?: string;
        } = {};
        if (opts.gender) input.gender = opts.gender;
        if (opts.language) input.language = opts.language;

        const response = await orpc.voice.catalog(input);

        if (globals.json) {
          output.json(response);
          return;
        }

        if (!response.voices || response.voices.length === 0) {
          output.info('No voices found matching filters');
          return;
        }

        output.table(
          ['ID', 'Name', 'Gender', 'Language', 'Accent', 'Age', 'Sounds like'],
          response.voices.map((v) => [
            v.id,
            v.name,
            v.gender,
            v.language,
            v.accent ?? '-',
            v.age ?? '-',
            v.descriptors.length > 0 ? v.descriptors.join(', ') : '-',
          ]),
        );

        output.info(`\n${response.voices.length} voice(s) found`);
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
