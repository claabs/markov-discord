/* eslint-disable no-console */
import 'source-map-support/register';
import 'reflect-metadata';
import * as Discord from 'discord.js';

import Markov, {
  MarkovGenerateOptions,
  MarkovConstructorOptions,
  AddDataProps,
} from 'markov-strings-db';

import { createConnection } from 'typeorm';
import { MarkovInputData } from 'markov-strings-db/dist/src/entity/MarkovInputData';
import { APIInteractionGuildMember } from 'discord-api-types';
import type { PackageJsonPerson } from 'types-package-json';
import L from './logger';
import { Channel } from './entity/Channel';
import { Guild } from './entity/Guild';
import { config } from './config';
import {
  CHANNEL_OPTIONS_MAX,
  deployCommands,
  helpCommand,
  inviteCommand,
  listenChannelCommand,
  messageCommand,
  trainCommand,
} from './deploy-commands';
import { getRandomElement, getVersion, packageJson } from './util';

interface MarkovDataCustom {
  attachments: string[];
}

const INVALID_PERMISSIONS_MESSAGE = 'You do not have the permissions for this action.';
const INVALID_GUILD_MESSAGE = 'This action must be performed within a server.';

const client = new Discord.Client<true>({
  intents: [Discord.Intents.FLAGS.GUILD_MESSAGES, Discord.Intents.FLAGS.GUILDS],
  presence: {
    activities: [
      {
        type: 'PLAYING',
        name: config.activity,
        url: packageJson().homepage,
      },
    ],
  },
});

const markovOpts: MarkovConstructorOptions = {
  stateSize: config.stateSize,
};

const markovGenerateOptions: MarkovGenerateOptions<MarkovDataCustom> = {
  filter: (result): boolean => {
    return result.score >= config.minScore;
  },
  maxTries: config.maxTries,
};

async function getMarkovByGuildId(guildId: string): Promise<Markov> {
  const markov = new Markov({ id: guildId, options: { ...markovOpts, id: guildId } });
  await markov.setup(); // Connect the markov instance to the DB to assign it an ID
  return markov;
}

async function getValidChannels(guild: Discord.Guild): Promise<Discord.TextChannel[]> {
  const dbChannels = await Channel.find({ guild: Guild.create({ id: guild.id }), listen: true });
  const channels = (
    await Promise.all(
      dbChannels.map(async (dbc) => {
        return guild.channels.fetch(dbc.id.toString());
      })
    )
  ).filter((c): c is Discord.TextChannel => c !== null && c instanceof Discord.TextChannel);
  return channels;
}

async function addValidChannels(channels: Discord.TextChannel[], guildId: string): Promise<void> {
  const dbChannels = channels.map((c) => {
    return Channel.create({ id: c.id, guild: Guild.create({ id: guildId }), listen: true });
  });
  await Channel.save(dbChannels);
}

async function removeValidChannels(
  channels: Discord.TextChannel[],
  guildId: string
): Promise<void> {
  const dbChannels = channels.map((c) => {
    return Channel.create({ id: c.id, guild: Guild.create({ id: guildId }), listen: false });
  });
  await Channel.save(dbChannels);
}

/**
 * Checks if the author of a message as moderator-like permissions.
 * @param {GuildMember} member Sender of the message
 * @return {Boolean} True if the sender is a moderator.
 *
 */
function isModerator(member: Discord.GuildMember | APIInteractionGuildMember | null): boolean {
  const MODERATOR_PERMISSIONS: Discord.PermissionResolvable[] = [
    'ADMINISTRATOR',
    'MANAGE_CHANNELS',
    'KICK_MEMBERS',
    'MOVE_MEMBERS',
  ];
  if (!member) return false;
  if (member instanceof Discord.GuildMember) {
    return (
      MODERATOR_PERMISSIONS.some((p) => member.permissions.has(p)) ||
      config.ownerIds.includes(member.id)
    );
  }
  // TODO: How to parse API permissions?
  L.debug({ permissions: member.permissions });
  return true;
}

type MessageCommands = 'respond' | 'train' | 'help' | 'invite' | 'debug' | 'tts' | null;

/**
 * Reads a new message and checks if and which command it is.
 * @param {Message} message Message to be interpreted as a command
 * @return {String} Command string
 */
function validateMessage(message: Discord.Message): MessageCommands {
  const messageText = message.content.toLowerCase();
  let command: MessageCommands = null;
  const thisPrefix = messageText.substring(0, config.messageCommandPrefix.length);
  if (thisPrefix === config.messageCommandPrefix) {
    const split = messageText.split(' ');
    if (split[0] === config.messageCommandPrefix && split.length === 1) {
      command = 'respond';
    } else if (split[1] === 'train') {
      command = 'train';
    } else if (split[1] === 'help') {
      command = 'help';
    } else if (split[1] === 'invite') {
      command = 'invite';
    } else if (split[1] === 'debug') {
      command = 'debug';
    } else if (split[1] === 'tts') {
      command = 'tts';
    }
  }
  return command;
}

function messageToData(message: Discord.Message): AddDataProps {
  const attachmentUrls = message.attachments.map((a) => a.url);
  let custom: MarkovDataCustom | undefined;
  if (attachmentUrls.length) custom = { attachments: attachmentUrls };
  return {
    string: message.content,
    custom,
  };
}

/**
 * Recursively gets all messages in a text channel's history.
 */
async function saveGuildMessageHistory(
  interaction: Discord.Message | Discord.CommandInteraction
): Promise<string> {
  if (!isModerator(interaction.member as any)) return INVALID_PERMISSIONS_MESSAGE;
  if (!interaction.guildId || !interaction.guild) return INVALID_GUILD_MESSAGE;
  const markov = await getMarkovByGuildId(interaction.guildId);
  const channels = await getValidChannels(interaction.guild);

  if (!channels.length) {
    L.warn({ guildId: interaction.guildId }, 'No channels to train from');
    return 'No channels configured to learn from. Set some with `/listen add`.';
  }

  L.debug('Deleting old data');
  await markov.delete();

  const channelIds = channels.map((c) => c.id);
  L.debug({ channelIds }, `Training from text channels`);

  const PAGE_SIZE = 100;
  let messagesCount = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const channel of channels) {
    let oldestMessageID: string | undefined;
    let keepGoing = true;
    L.debug({ channelId: channel.id, messagesCount }, `Training from channel`);

    while (keepGoing) {
      // eslint-disable-next-line no-await-in-loop
      const messages = await channel.messages.fetch({
        before: oldestMessageID,
        limit: PAGE_SIZE,
      });
      const nonBotMessageFormatted = messages.filter((elem) => !elem.author.bot).map(messageToData);
      L.trace({ oldestMessageID }, `Saving ${nonBotMessageFormatted.length} messages`);
      // eslint-disable-next-line no-await-in-loop
      await markov.addData(nonBotMessageFormatted);
      L.trace('Finished saving messages');
      messagesCount += nonBotMessageFormatted.length;
      const lastMessage = messages.last();
      if (!lastMessage || messages.size < PAGE_SIZE) {
        keepGoing = false;
      } else {
        oldestMessageID = lastMessage.id;
      }
    }
  }

  L.info({ channelIds }, `Trained from ${messagesCount} past human authored messages.`);
  return `Trained from ${messagesCount} past human authored messages.`;
}

interface GenerateResponse {
  message?: Discord.MessageOptions;
  debug?: Discord.MessageOptions;
  error?: Discord.MessageOptions;
}

/**
 * General Markov-chain response function
 * @param interaction The message that invoked the action, used for channel info.
 * @param debug Sends debug info as a message if true.
 * @param tts If the message should be sent as TTS. Defaults to the TTS setting of the
 * invoking message.
 */
async function generateResponse(
  interaction: Discord.Message | Discord.CommandInteraction,
  debug = false,
  tts = false
): Promise<GenerateResponse> {
  L.debug('Responding...');
  if (!interaction.guildId) {
    L.warn('Received an interaction without a guildId');
    return { message: { content: INVALID_GUILD_MESSAGE } };
  }
  if (!interaction.channelId) {
    L.warn('Received an interaction without a channelId');
    return { message: { content: 'This action must be performed within a text channel.' } };
  }
  const markov = await getMarkovByGuildId(interaction.guildId);

  try {
    const response = await markov.generate<MarkovDataCustom>(markovGenerateOptions);
    L.info({ string: response.string }, 'Generated response text');
    L.debug({ response }, 'Generated response object');
    const messageOpts: Discord.MessageOptions = { tts };
    const attachmentUrls = response.refs
      .filter((ref) => ref.custom && 'attachments' in ref.custom)
      .flatMap((ref) => ref.custom.attachments);
    if (attachmentUrls.length > 0) {
      const randomRefAttachment = getRandomElement(attachmentUrls);
      messageOpts.files = [randomRefAttachment];
    } else {
      const randomMessage = await MarkovInputData.createQueryBuilder<
        MarkovInputData<MarkovDataCustom>
      >('input')
        .leftJoinAndSelect('input.fragment', 'fragment')
        .leftJoinAndSelect('fragment.corpusEntry', 'corpusEntry')
        .where([
          {
            fragment: { startWordMarkov: markov.db },
          },
          {
            fragment: { endWordMarkov: markov.db },
          },
          {
            fragment: { corpusEntry: { markov: markov.db } },
          },
        ])
        .orderBy('RANDOM()')
        .limit(1)
        .getOne();
      const randomMessageAttachmentUrls = randomMessage?.custom?.attachments;
      if (randomMessageAttachmentUrls?.length) {
        messageOpts.files = [{ attachment: getRandomElement(randomMessageAttachmentUrls) }];
      }
    }

    response.string = response.string.replace(/@everyone/g, '@everyοne'); // Replace @everyone with a homoglyph 'o'
    messageOpts.content = response.string;

    const responseMessages: GenerateResponse = {
      message: messageOpts,
    };
    if (debug) {
      responseMessages.debug = { content: `\`\`\`\n${JSON.stringify(response, null, 2)}\n\`\`\`` };
    }
    return responseMessages;
  } catch (err) {
    L.error(err);
    return { error: { content: `\n\`\`\`\nERROR: ${err}\n\`\`\`` } };
  }
}

async function listValidChannels(interaction: Discord.CommandInteraction): Promise<string> {
  if (!interaction.guildId || !interaction.guild) return INVALID_GUILD_MESSAGE;
  const channels = await getValidChannels(interaction.guild);
  const channelText = channels.reduce((list, channel) => {
    return `${list}\n • <#${channel.id}>`;
  }, '');
  return `This bot is currently listening and learning from ${channels.length} channel(s).${channelText}`;
}

function getChannelsFromInteraction(
  interaction: Discord.CommandInteraction
): Discord.TextChannel[] {
  const channels = Array.from(Array(CHANNEL_OPTIONS_MAX).keys()).map((index) =>
    interaction.options.getChannel(`channel-${index + 1}`, index === 0)
  );
  const textChannels = channels.filter(
    (c): c is Discord.TextChannel => c !== null && c instanceof Discord.TextChannel
  );
  return textChannels;
}

function helpMessage(): Discord.MessageOptions {
  const avatarURL = client.user.avatarURL() || undefined;
  const embed = new Discord.MessageEmbed()
    .setAuthor(client.user.username || packageJson().name, avatarURL)
    .setThumbnail(avatarURL as string)
    .setDescription('A Markov chain chatbot that speaks based on previous chat input.')
    .addField(
      `${config.messageCommandPrefix} or /${messageCommand.name}`,
      'Generates a sentence to say based on the chat database. Send your ' +
        'message as TTS to recieve it as TTS.'
    )
    .addField(
      `${config.messageCommandPrefix} train or /${trainCommand.name}`,
      'Fetches the maximum amount of previous messages in the current ' +
        'text channel, adds it to the database, and regenerates the corpus. Takes some time.'
    )
    .addField(
      `${config.messageCommandPrefix} invite or /${inviteCommand.name}`,
      "Don't invite this bot to other servers. The database is shared " +
        'between all servers and text channels.'
    )
    .addField(
      `${config.messageCommandPrefix} debug or /${messageCommand.name} debug: True`,
      `Runs the ${config.messageCommandPrefix} command and follows it up with debug info.`
    )
    .addField(
      `${config.messageCommandPrefix} tts or /${messageCommand.name} tts: True`,
      `Runs the ${config.messageCommandPrefix} command and reads it with text-to-speech.`
    )
    .setFooter(
      `${packageJson().name} ${getVersion()} by ${(packageJson().author as PackageJsonPerson).name}`
    );
  return {
    embeds: [embed],
  };
}

function inviteMessage(): Discord.MessageOptions {
  const avatarURL = client.user.avatarURL() || undefined;
  const embed = new Discord.MessageEmbed()
    .setAuthor(`Invite ${client.user?.username}`, avatarURL)
    .setThumbnail(avatarURL as string)
    .addField(
      'Invite',
      `[Invite ${client.user.username} to your server](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=105472&scope=bot%20applications.commands)`
    );
  return { embeds: [embed] };
}

client.on('ready', async (readyClient) => {
  L.info('Bot logged in');

  await deployCommands(readyClient.user.id);

  const guildsToSave = readyClient.guilds.valueOf().map((guild) => Guild.create({ id: guild.id }));
  await Guild.upsert(guildsToSave, ['id']);
});

client.on('guildCreate', async (guild) => {
  L.info({ guildId: guild.id }, 'Adding new guild');
  await Guild.upsert(Guild.create({ id: guild.id }), ['id']);
});

client.on('debug', (m) => L.trace(m));
client.on('warn', (m) => L.warn(m));
client.on('error', (m) => L.error(m));

client.on('messageCreate', async (message) => {
  if (!(message.guild && message.channel instanceof Discord.TextChannel)) return;
  const command = validateMessage(message);
  if (command !== null) L.info({ command }, 'Recieved message command');
  if (command === 'help') {
    await message.channel.send(helpMessage());
  }
  if (command === 'invite') {
    await message.channel.send(inviteMessage());
  }
  if (command === 'train') {
    const response = await saveGuildMessageHistory(message);
    await message.reply(response);
  }
  if (command === 'respond') {
    const generatedResponse = await generateResponse(message);
    if (generatedResponse.message) await message.reply(generatedResponse.message);
    if (generatedResponse.debug) await message.reply(generatedResponse.debug);
    if (generatedResponse.error) await message.reply(generatedResponse.error);
  }
  if (command === 'tts') {
    await generateResponse(message, false, true);
  }
  if (command === 'debug') {
    await generateResponse(message, true);
  }
  if (command === null) {
    if (!message.author.bot) {
      L.debug('Listening...');
      const markov = await getMarkovByGuildId(message.channel.guildId);
      await markov.addData([messageToData(message)]);

      if (client.user && message.mentions.has(client.user)) {
        await generateResponse(message);
      }
    }
  }
});

client.on('messageDelete', async (message) => {
  if (message.author?.bot) return;
  L.debug(`Deleting message ${message.id}`);
  if (!(message.guildId && message.content)) {
    return;
  }
  const markov = await getMarkovByGuildId(message.guildId);
  await markov.removeData([message.content]);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot) return;
  L.debug(`Editing message ${oldMessage.id}`);
  if (!(oldMessage.guildId && oldMessage.content && newMessage.content)) {
    return;
  }
  const markov = await getMarkovByGuildId(oldMessage.guildId);
  await markov.removeData([oldMessage.content]);
  await markov.addData([newMessage.content]);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  L.info({ command: interaction.commandName }, 'Recieved slash command');

  if (interaction.commandName === helpCommand.name) {
    await interaction.reply(helpMessage());
  } else if (interaction.commandName === inviteCommand.name) {
    await interaction.reply(inviteMessage());
  } else if (interaction.commandName === messageCommand.name) {
    await interaction.deferReply();
    const tts = interaction.options.getBoolean('tts') || false;
    const debug = interaction.options.getBoolean('debug') || false;
    const generatedResponse = await generateResponse(interaction, debug, tts);
    if (generatedResponse.message) await interaction.editReply(generatedResponse.message);
    else await interaction.deleteReply();
    if (generatedResponse.debug) await interaction.followUp(generatedResponse.debug);
    if (generatedResponse.error) {
      await interaction.followUp({ ...generatedResponse.error, ephemeral: true });
    }
  } else if (interaction.commandName === listenChannelCommand.name) {
    await interaction.deferReply();
    const subCommand = interaction.options.getSubcommand(true) as 'add' | 'remove' | 'list';
    if (subCommand === 'list') {
      const reply = await listValidChannels(interaction);
      await interaction.editReply(reply);
    } else if (subCommand === 'add') {
      if (!isModerator(interaction.member as any)) {
        await interaction.deleteReply();
        await interaction.followUp({ content: INVALID_PERMISSIONS_MESSAGE, ephemeral: true });
        return;
      }
      const channels = getChannelsFromInteraction(interaction);
      await addValidChannels(channels, interaction.guildId);
      await interaction.editReply(
        `Added ${channels.length} text channels to the list. Use \`/train\` to update the past known messages.`
      );
    } else if (subCommand === 'remove') {
      if (!isModerator(interaction.member as any)) {
        await interaction.deleteReply();
        await interaction.followUp({ content: INVALID_PERMISSIONS_MESSAGE, ephemeral: true });
        return;
      }
      const channels = getChannelsFromInteraction(interaction);
      await removeValidChannels(channels, interaction.guildId);
      await interaction.editReply(
        `Removed ${channels.length} text channels from the list. Use \`/train\` to remove these channels from the past known messages.`
      );
    }
  } else if (interaction.commandName === trainCommand.name) {
    await interaction.deferReply();
    const responseMessage = await saveGuildMessageHistory(interaction);
    await interaction.editReply(responseMessage);
  }
});

/**
 * Loads the config settings from disk
 */
async function main(): Promise<void> {
  const connection = await Markov.extendConnectionOptions();
  await createConnection(connection);
  await client.login(config.token);
}

main();
