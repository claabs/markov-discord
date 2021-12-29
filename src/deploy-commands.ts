import { SlashCommandBuilder, SlashCommandChannelOption } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { ChannelType, Routes } from 'discord-api-types/v9';
import { config } from './config';
import { packageJson } from './util';

export const CHANNEL_OPTIONS_MAX = 25;

export const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription(`How to use ${packageJson().name}`);

export const inviteCommand = new SlashCommandBuilder()
  .setName('invite')
  .setDescription('Get the invite link for this bot.');

export const messageCommand = new SlashCommandBuilder()
  .setName(config.slashCommandName)
  .setDescription('Generate a message from learned past messages')
  .addBooleanOption((tts) =>
    tts.setName('tts').setDescription('Read the message via text-to-speech.').setRequired(false)
  )
  .addBooleanOption((debug) =>
    debug
      .setName('debug')
      .setDescription('Follow up the generated message with the detailed sources that inspired it.')
      .setRequired(false)
  );

/**
 * Helps generate a list of parameters for channel options
 */
const channelOptionsGenerator = (builder: SlashCommandChannelOption, index: number) =>
  builder
    .setName(`channel-${index + 1}`)
    .setDescription('A text channel')
    .setRequired(index === 0)
    .addChannelType(ChannelType.GuildText as any);

export const listenChannelCommand = new SlashCommandBuilder()
  .setName('listen')
  .setDescription('Change what channels the bot actively listens to and learns from.')
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
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription(`List the channels the bot is currently actively listening to.`)
  )
  .addSubcommand((sub) =>
    sub
      .setName('modify')
      .setDescription(`Add or remove channels via select menu UI (first 25 text channels only)`)
  );

export const trainCommand = new SlashCommandBuilder()
  .setName('train')
  .setDescription(
    'Train from past messages from the configured listened channels. This takes a while.'
  );

const commands = [
  helpCommand.toJSON(),
  inviteCommand.toJSON(),
  messageCommand.toJSON(),
  listenChannelCommand.toJSON(),
  trainCommand.toJSON(),
];

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
