import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import { config } from './config';
import { packageJson } from './util';

const helpSlashCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription(`How to use ${packageJson().name}`);

const commands = [helpSlashCommand.toJSON()];

export async function deployCommands(clientId: string) {
  const rest = new REST({ version: '9' }).setToken(config.token);
  if (config.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, config.devGuildId), {
      body: commands,
    });
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
  }
}
