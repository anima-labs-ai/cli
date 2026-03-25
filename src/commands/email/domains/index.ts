import { Command } from 'commander';
import { addDomainCommand } from './add.js';
import { verifyDomainCommand } from './verify.js';
import { listDomainsCommand } from './list.js';
import { getDomainCommand } from './get.js';
import { deleteDomainCommand } from './delete.js';
import { domainDnsCommand } from './dns.js';
import { domainDeliverabilityCommand } from './deliverability.js';

export function domainCommands(): Command {
  const cmd = new Command('domains')
    .description('Manage email sending domains');

  cmd.addCommand(addDomainCommand());
  cmd.addCommand(verifyDomainCommand());
  cmd.addCommand(listDomainsCommand());
  cmd.addCommand(getDomainCommand());
  cmd.addCommand(deleteDomainCommand());
  cmd.addCommand(domainDnsCommand());
  cmd.addCommand(domainDeliverabilityCommand());

  return cmd;
}
