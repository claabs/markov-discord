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
import L from './logger';
import { Channel } from './entity/Channel';
import { Guild } from './entity/Guild';
import { config } from './config';
import {
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

/**
 * #v3-complete
 */
async function getMarkovByGuildId(guildId: string): Promise<Markov> {
  const id = parseInt(guildId, 10);
  const markov = new Markov({ id, options: markovOpts });
  await markov.setup(); // Connect the markov instance to the DB to assign it an ID
  return markov;
}

/**
 * #v3-complete
 */
async function isValidChannel(channelId: string): Promise<boolean> {
  const id = parseInt(channelId, 10);
  const channel = await Channel.findOne(id);
  if (!channel) {
    L.warn({ channelId }, 'Channel does not exist, setting to valid');
    await Channel.create({ id }).save();
    return false;
  }
  return channel.listen;
}

/**
 * #v3-complete
 */
async function getValidChannels(guildId: string): Promise<Discord.TextChannel[]> {
  const id = parseInt(guildId, 10);
  const dbChannels = await Channel.find({ guild: Guild.create({ id }), listen: true });
  const channels = (
    await Promise.all(dbChannels.map(async (dbc) => client.channels.fetch(dbc.id.toString())))
  ).filter((c): c is Discord.TextChannel => c !== null && c instanceof Discord.TextChannel);
  return channels;
}

/**
 * Checks if the author of a message as moderator-like permissions.
 * @param {GuildMember} member Sender of the message
 * @return {Boolean} True if the sender is a moderator.
 * #v3-complete
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
 * #v3-complete
 */
async function saveGuildMessageHistory(
  interaction: Discord.Message | Discord.CommandInteraction
): Promise<string> {
  if (!isModerator(interaction.member as any))
    return 'You do not have the permissions for this action.';
  if (!interaction.guildId) return 'This action must be performed within a server.';
  const markov = await getMarkovByGuildId(interaction.guildId);
  const channels = await getValidChannels(interaction.guildId);

  if (!channels.length) {
    L.warn({ guildId: interaction.guildId }, 'No channels to train from');
    return 'No channels configured to learn from. Set some with `/listen add`.';
  }

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
}

/**
 * General Markov-chain response function
 * @param interaction The message that invoked the action, used for channel info.
 * @param debug Sends debug info as a message if true.
 * @param tts If the message should be sent as TTS. Defaults to the TTS setting of the
 * invoking message.
 * #v3-complete
 */
async function generateResponse(
  interaction: Discord.Message | Discord.CommandInteraction,
  debug = false,
  tts = false
): Promise<GenerateResponse> {
  L.debug('Responding...');
  if (!interaction.guildId) {
    L.warn('Received an interaction without a guildId');
    return { message: { content: 'This action must be performed within a server.' } };
  }
  if (!interaction.channelId) {
    L.warn('Received an interaction without a channelId');
    return { message: { content: 'This action must be performed within a text channel.' } };
  }
  const markov = await getMarkovByGuildId(interaction.guildId);

  try {
    const response = await markov.generate<MarkovDataCustom>(markovGenerateOptions);
    L.info({ response }, 'Generated response');
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
    if (debug) {
      return { debug: { content: `\n\`\`\`\nERROR: ${err}\n\`\`\`` } };
    }
    return {};
  }
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
    .setFooter(`${packageJson().name} ${getVersion()} by ${packageJson().author}`);
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

  const guildsToSave = readyClient.guilds
    .valueOf()
    .map((guild) => Guild.create({ id: parseInt(guild.id, 10) }));
  await Guild.upsert(guildsToSave, ['id']);
});

client.on('error', (err) => {
  L.error(err);
});

client.on('messageCreate', async (message) => {
  if (!(message.guild && message.channel instanceof Discord.TextChannel)) return;
  const command = validateMessage(message);
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
  }
  if (command === 'tts') {
    await generateResponse(message, false, true);
  }
  if (command === 'debug') {
    await generateResponse(message, true);
  }
  if (command === null) {
    L.debug('Listening...');
    if (!message.author.bot) {
      const markov = await getMarkovByGuildId(message.channel.guildId);
      await markov.addData([messageToData(message)]);

      if (client.user && message.mentions.has(client.user)) {
        await generateResponse(message);
      }
    }
  }
});

/**
 * #v3-complete
 */
client.on('messageDelete', async (message) => {
  if (message.author?.bot) return;
  L.info(`Deleting message ${message.id}`);
  if (!(message.guildId && message.content)) {
    return;
  }
  const markov = await getMarkovByGuildId(message.guildId);
  await markov.removeData([message.content]);
});

/**
 * #v3-complete
 */
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot) return;
  L.info(`Editing message ${oldMessage.id}`);
  if (!(oldMessage.guildId && oldMessage.content && newMessage.content)) {
    return;
  }
  const markov = await getMarkovByGuildId(oldMessage.guildId);
  await markov.removeData([oldMessage.content]);
  await markov.addData([newMessage.content]);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  // Unprivileged commands
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
    if (generatedResponse.debug) await interaction.followUp(generatedResponse.debug);
    if (!Object.keys(generatedResponse).length) await interaction.deleteReply();
  }
  // Privileged commands
  if (interaction.commandName === listenChannelCommand.name) {
    await interaction.reply('Pong!');
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

  // Move config if in legacy location
  // TODO: import legacy DB?
}

main();
