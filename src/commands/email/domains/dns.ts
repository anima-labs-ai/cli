import { Command } from 'commander';
import { Output } from '../../../lib/output.js';
import { type GlobalOptions } from '../../../lib/auth.js';
import { requireOrpcAuth, handleOrpcError } from '../../../lib/orpc.js';
import { requireNonEmptyArg } from '../../../lib/args.js';

export function domainDnsCommand(): Command {
  return new Command('dns')
    .description('Show domain DNS records')
    .argument('<id>', 'Domain ID', requireNonEmptyArg('Domain ID'))
    .action(async function (this: Command, id: string) {
      const globals = this.optsWithGlobals<GlobalOptions>();
      const output = Output.fromGlobals(globals);

      try {
        const orpc = await requireOrpcAuth(globals);
        const result = await orpc.domain.dnsRecords({ id });

        if (globals.json) {
          output.json(result);
          return;
        }

        const rows: string[][] = [];
        rows.push(['TXT', result.txt.name, result.txt.value, '-']);
        rows.push([
          'MX',
          result.mailFrom.name,
          result.mailFrom.mx.value,
          String(result.mailFrom.mx.priority),
        ]);
        rows.push(['TXT (MAIL FROM SPF)', result.mailFrom.name, result.mailFrom.spf, '-']);
        for (const dkim of result.dkim) {
          rows.push(['CNAME (DKIM)', dkim.name, dkim.value, '-']);
        }
        rows.push(['MX', result.mx.name, result.mx.value, String(result.mx.priority)]);
        rows.push(['TXT (SPF)', '@', result.spf, '-']);
        rows.push(['TXT (DMARC)', '_dmarc', result.dmarc, '-']);

        output.table(['Type', 'Name', 'Value', 'Priority'], rows);
      } catch (error: unknown) {
        handleOrpcError(error, output, 'Failed to fetch DNS records', { statusMessages: { 404: 'Domain not found.' } });
      }
    });
}
