import { Command } from 'commander';
import { createWebhookCommand } from './create.js';
import { listWebhooksCommand } from './list.js';
import { getWebhookCommand } from './get.js';
import { deleteWebhookCommand } from './delete.js';
import { testWebhookCommand } from './test.js';
import { webhookDeliveriesCommand } from './deliveries.js';

export function webhookCommands(): Command {
  const cmd = new Command('webhook')
    .description('Manage webhooks');

  cmd.addCommand(createWebhookCommand());
  cmd.addCommand(listWebhooksCommand());
  cmd.addCommand(getWebhookCommand());
  cmd.addCommand(deleteWebhookCommand());
  cmd.addCommand(testWebhookCommand());
  cmd.addCommand(webhookDeliveriesCommand());

  return cmd;
}
