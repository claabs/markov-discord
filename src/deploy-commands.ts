import { SlashCommandBuilder, SlashCommandChannelOption } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { ChannelType, Routes } from 'discord-api-types/v9';
import { config } from './config';
import { packageJson } from './util';

const CHANNEL_OPTIONS_MAX = 25;

const helpSlashCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription(`How to use ${packageJson().name}`);

/**
 * Helps generate a list of parameters for channel options
 */
const channelOptionsGenerator = (builder: SlashCommandChannelOption, index: number) =>
  builder
    .setName(`channel-${index + 1}`)
    .setDescription('A text channel')
    .setRequired(index === 0)
    .addChannelType(ChannelType.GuildText as any);

const listenChannelCommand = new SlashCommandBuilder()
  .setName('listen')
  .addSubcommand((sub) => {
    sub
      .setName('add')
      .setDescription(
        `Add channels to learn from. Doesn't add the channel's past messages; re-train to do that.`
      );

    Array.from(Array(CHANNEL_OPTIONS_MAX).keys()).forEach((index) =>
      sub.addChannelOption((opt) => channelOptionsGenerator(opt, index))
    );
    return sub;
  })
  .addSubcommand((sub) => {
    sub
      .setName('remove')
      .setDescription(
        `Remove channels from being learned from. Doesn't remove the channel's data; re-train to do that.`
      );
    Array.from(Array(CHANNEL_OPTIONS_MAX).keys()).forEach((index) =>
      sub.addChannelOption((opt) => channelOptionsGenerator(opt, index))
    );
    return sub;
  })
  .setDescription(`How to use ${packageJson().name}`);

const commands = [helpSlashCommand.toJSON(), listenChannelCommand.toJSON()];

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
