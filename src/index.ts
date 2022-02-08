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
import type { PackageJsonPerson } from 'types-package-json';
import makeEta from 'simple-eta';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import addSeconds from 'date-fns/addSeconds';
import type { APIInteractionGuildMember, APISelectMenuComponent } from 'discord-api-types';
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

interface SelectMenuChannel {
  id: string;
  listen?: boolean;
  name?: string;
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
    return (
      result.score >= config.minScore && !result.refs.some((ref) => ref.string === result.string)
    );
  },
  maxTries: config.maxTries,
};

async function getMarkovByGuildId(guildId: string): Promise<Markov> {
  const markov = new Markov({ id: guildId, options: { ...markovOpts, id: guildId } });
  L.trace({ guildId }, 'Setting up markov instance');
  await markov.setup(); // Connect the markov instance to the DB to assign it an ID
  return markov;
}

/**
 * Returns a thread channels parent guild channel ID, otherwise it just returns a channel ID
 */
function getGuildChannelId(channel: Discord.TextBasedChannel): string | null {
  if (channel.isThread()) {
    return channel.parentId;
  }
  return channel.id;
}

async function isValidChannel(channel: Discord.TextBasedChannel): Promise<boolean> {
  const channelId = getGuildChannelId(channel);
  if (!channelId) return false;
  const dbChannel = await Channel.findOne(channelId);
  return dbChannel?.listen || false;
}

function isHumanAuthoredMessage(message: Discord.Message | Discord.PartialMessage): boolean {
  return !(message.author?.bot || message.system);
}

async function getValidChannels(guild: Discord.Guild): Promise<Discord.TextChannel[]> {
  L.trace('Getting valid channels from database');
  const dbChannels = await Channel.find({ guild: Guild.create({ id: guild.id }), listen: true });
  L.trace({ dbChannels: dbChannels.map((c) => c.id) }, 'Valid channels from database');
  const channels = (
    await Promise.all(
      dbChannels.map(async (dbc) => {
        const channelId = dbc.id;
        try {
          return guild.channels.fetch(channelId);
        } catch (err) {
          L.error({ erroredChannel: dbc, channelId }, 'Error fetching channel');
          throw err;
        }
      })
    )
  ).filter((c): c is Discord.TextChannel => c !== null && c instanceof Discord.TextChannel);
  return channels;
}

async function getTextChannels(guild: Discord.Guild): Promise<SelectMenuChannel[]> {
  L.trace('Getting text channels for select menu');
  const MAX_SELECT_OPTIONS = 25;
  const textChannels = guild.channels.cache.filter(
    (c): c is Discord.TextChannel => c !== null && c instanceof Discord.TextChannel
  );
  const foundDbChannels = await Channel.findByIds(Array.from(textChannels.keys()));
  const foundDbChannelsWithName: SelectMenuChannel[] = foundDbChannels.map((c) => ({
    ...c,
    name: textChannels.find((t) => t.id === c.id)?.name,
  }));
  const notFoundDbChannels: SelectMenuChannel[] = textChannels
    .filter((c) => !foundDbChannels.find((d) => d.id === c.id))
    .map((c) => ({ id: c.id, listen: false, name: textChannels.find((t) => t.id === c.id)?.name }));
  const limitedDbChannels = foundDbChannelsWithName
    .concat(notFoundDbChannels)
    .slice(0, MAX_SELECT_OPTIONS);
  return limitedDbChannels;
}

async function addValidChannels(channels: Discord.TextChannel[], guildId: string): Promise<void> {
  L.trace(`Adding ${channels.length} channels to valid list`);
  const dbChannels = channels.map((c) => {
    return Channel.create({ id: c.id, guild: Guild.create({ id: guildId }), listen: true });
  });
  await Channel.save(dbChannels);
}

async function removeValidChannels(
  channels: Discord.TextChannel[],
  guildId: string
): Promise<void> {
  L.trace(`Removing ${channels.length} channels from valid list`);
  const dbChannels = channels.map((c) => {
    return Channel.create({ id: c.id, guild: Guild.create({ id: guildId }), listen: false });
  });
  await Channel.save(dbChannels);
}

/**
 * Checks if the author of a command has moderator-like permissions.
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

/**
 * Checks if the author of a command has a role in the `userRoleIds` config option (if present).
 * @param {GuildMember} member Sender of the message
 * @return {Boolean} True if the sender is a moderator.
 *
 */
function isAllowedUser(member: Discord.GuildMember | APIInteractionGuildMember | null): boolean {
  if (!config.userRoleIds.length) return true;
  if (!member) return false;
  if (member instanceof Discord.GuildMember) {
    return config.userRoleIds.some((p) => member.roles.cache.has(p));
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
  const tags: string[] = [message.id];
  if (message.channel.isThread()) tags.push(message.channelId); // Add thread channel ID
  const channelId = getGuildChannelId(message.channel);
  if (channelId) tags.push(channelId); // Add guild channel ID
  if (message.guildId) tags.push(message.guildId); // Add guild ID
  return {
    string: message.content,
    custom,
    tags,
  };
}

/**
 * Recursively gets all messages in a text channel's history.
 */
async function saveGuildMessageHistory(
  interaction: Discord.Message | Discord.CommandInteraction
): Promise<string> {
  if (!isModerator(interaction.member)) return INVALID_PERMISSIONS_MESSAGE;
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

  const messageContent = `Parsing past messages from ${channels.length} channel(s).`;

  const NO_COMPLETED_CHANNELS_TEXT = 'None';
  const completedChannelsField: Discord.EmbedFieldData = {
    name: 'Completed Channels',
    value: NO_COMPLETED_CHANNELS_TEXT,
    inline: true,
  };
  const currentChannelField: Discord.EmbedFieldData = {
    name: 'Current Channel',
    value: `<#${channels[0].id}>`,
    inline: true,
  };
  const currentChannelPercent: Discord.EmbedFieldData = {
    name: 'Channel Progress',
    value: '0%',
    inline: true,
  };
  const currentChannelEta: Discord.EmbedFieldData = {
    name: 'Channel Time Remaining',
    value: 'Pending...',
    inline: true,
  };
  const embedOptions: Discord.MessageEmbedOptions = {
    title: 'Training Progress',
    fields: [completedChannelsField, currentChannelField, currentChannelPercent, currentChannelEta],
  };
  const embed = new Discord.MessageEmbed(embedOptions);
  let progressMessage: Discord.Message;
  const updateMessageData = { content: messageContent, embeds: [embed] };
  if (interaction instanceof Discord.Message) {
    progressMessage = await interaction.reply(updateMessageData);
  } else {
    progressMessage = (await interaction.followUp(updateMessageData)) as Discord.Message;
  }

  const PAGE_SIZE = 100;
  const UPDATE_RATE = 1000; // In number of messages processed
  let lastUpdate = 0;
  let messagesCount = 0;
  let firstMessageDate: number | undefined;
  // eslint-disable-next-line no-restricted-syntax
  for (const channel of channels) {
    let oldestMessageID: string | undefined;
    let keepGoing = true;
    L.debug({ channelId: channel.id, messagesCount }, `Training from channel`);
    const channelCreateDate = channel.createdTimestamp;
    const channelEta = makeEta({ autostart: true, min: 0, max: 1, historyTimeConstant: 30 });

    while (keepGoing) {
      let allBatchMessages = new Discord.Collection<string, Discord.Message<boolean>>();
      let channelBatchMessages: Discord.Collection<string, Discord.Message<boolean>>;
      try {
        // eslint-disable-next-line no-await-in-loop
        channelBatchMessages = await channel.messages.fetch({
          before: oldestMessageID,
          limit: PAGE_SIZE,
        });
      } catch (err) {
        L.error(err);
        L.error(
          `Error retreiving messages before ${oldestMessageID} in channel ${channel.name}. This is probably a permissions issue.`
        );
        break; // Give up on this channel
      }

      // Gather any thread messages if present in this message batch
      const threadChannels = channelBatchMessages
        .filter((m) => m.hasThread)
        .map((m) => m.thread)
        .filter((c): c is Discord.ThreadChannel => c !== null);
      if (threadChannels.length > 0) {
        L.debug(`Found ${threadChannels.length} threads. Reading into them.`);
        // eslint-disable-next-line no-restricted-syntax
        for (const threadChannel of threadChannels) {
          let oldestThreadMessageID: string | undefined;
          let keepGoingThread = true;
          L.debug({ channelId: threadChannel.id }, `Training from thread`);

          while (keepGoingThread) {
            let threadBatchMessages: Discord.Collection<string, Discord.Message<boolean>>;
            try {
              // eslint-disable-next-line no-await-in-loop
              threadBatchMessages = await threadChannel.messages.fetch({
                before: oldestThreadMessageID,
                limit: PAGE_SIZE,
              });
            } catch (err) {
              L.error(err);
              L.error(
                `Error retreiving thread messages before ${oldestThreadMessageID} in thread ${threadChannel.name}. This is probably a permissions issue.`
              );
              break; // Give up on this thread
            }
            L.trace(
              { threadMessagesCount: threadBatchMessages.size },
              `Found some thread messages`
            );
            const lastThreadMessage = threadBatchMessages.last();
            allBatchMessages = allBatchMessages.concat(threadBatchMessages); // Add the thread messages to this message batch to be included in later processing
            if (!lastThreadMessage?.id || threadBatchMessages.size < PAGE_SIZE) {
              keepGoingThread = false;
            } else {
              oldestThreadMessageID = lastThreadMessage.id;
            }
          }
        }
      }

      allBatchMessages = allBatchMessages.concat(channelBatchMessages);

      // Filter and data map messages to be ready for addition to the corpus
      const humanAuthoredMessages = allBatchMessages
        .filter((m) => isHumanAuthoredMessage(m))
        .map(messageToData);
      L.trace({ oldestMessageID }, `Saving ${humanAuthoredMessages.length} messages`);
      // eslint-disable-next-line no-await-in-loop
      await markov.addData(humanAuthoredMessages);
      L.trace('Finished saving messages');
      messagesCount += humanAuthoredMessages.length;
      const lastMessage = channelBatchMessages.last();

      // Update tracking metrics
      if (!lastMessage?.id || channelBatchMessages.size < PAGE_SIZE) {
        keepGoing = false;
        const channelIdListItem = ` • <#${channel.id}>`;
        if (completedChannelsField.value === NO_COMPLETED_CHANNELS_TEXT)
          completedChannelsField.value = channelIdListItem;
        else {
          completedChannelsField.value += `\n${channelIdListItem}`;
        }
      } else {
        oldestMessageID = lastMessage.id;
      }
      currentChannelField.value = `<#${channel.id}>`;
      if (!firstMessageDate) firstMessageDate = channelBatchMessages.first()?.createdTimestamp;
      const oldestMessageDate = lastMessage?.createdTimestamp;
      if (firstMessageDate && oldestMessageDate) {
        const channelAge = firstMessageDate - channelCreateDate;
        const lastMessageAge = firstMessageDate - oldestMessageDate;
        const pctComplete = lastMessageAge / channelAge;
        currentChannelPercent.value = `${(pctComplete * 100).toFixed(2)}%`;
        channelEta.report(pctComplete);
        const estimateSeconds = channelEta.estimate();
        if (Number.isFinite(estimateSeconds))
          currentChannelEta.value = formatDistanceToNow(addSeconds(new Date(), estimateSeconds), {
            includeSeconds: true,
          });
      }

      if (messagesCount > lastUpdate + UPDATE_RATE) {
        lastUpdate = messagesCount;
        L.debug(
          { messagesCount, pctComplete: currentChannelPercent.value },
          'Sending metrics update'
        );
        // eslint-disable-next-line no-await-in-loop
        await progressMessage.edit({
          ...updateMessageData,
          embeds: [new Discord.MessageEmbed(embedOptions)],
        });
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

interface GenerateOptions {
  tts?: boolean;
  debug?: boolean;
  startSeed?: string;
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
  options?: GenerateOptions
): Promise<GenerateResponse> {
  L.debug({ options }, 'Responding...');
  const { tts = false, debug = false, startSeed } = options || {};
  if (!interaction.guildId) {
    L.warn('Received an interaction without a guildId');
    return { error: { content: INVALID_GUILD_MESSAGE } };
  }
  if (!isAllowedUser(interaction.member)) {
    L.info('Member does not have permissions to generate a response');
    return { error: { content: INVALID_PERMISSIONS_MESSAGE } };
  }
  const markov = await getMarkovByGuildId(interaction.guildId);

  try {
    markovGenerateOptions.startSeed = startSeed;
    const response = await markov.generate<MarkovDataCustom>(markovGenerateOptions);
    L.info({ string: response.string }, 'Generated response text');
    L.debug({ response }, 'Generated response object');
    const messageOpts: Discord.MessageOptions = {
      tts,
      allowedMentions: { repliedUser: false, parse: [] },
    };
    const attachmentUrls = response.refs
      .filter((ref) => ref.custom && 'attachments' in ref.custom)
      .flatMap((ref) => (ref.custom as MarkovDataCustom).attachments);
    if (attachmentUrls.length > 0) {
      const randomRefAttachment = getRandomElement(attachmentUrls);
      messageOpts.files = [randomRefAttachment];
    } else {
      const randomMessage = await MarkovInputData.createQueryBuilder<
        MarkovInputData<MarkovDataCustom>
      >('input')
        .leftJoinAndSelect('input.markov', 'markov')
        .where({ markov: markov.db })
        .orderBy('RANDOM()')
        .limit(1)
        .getOne();
      const randomMessageAttachmentUrls = randomMessage?.custom?.attachments;
      if (randomMessageAttachmentUrls?.length) {
        messageOpts.files = [{ attachment: getRandomElement(randomMessageAttachmentUrls) }];
      }
    }
    messageOpts.content = response.string;

    const responseMessages: GenerateResponse = {
      message: messageOpts,
    };
    if (debug) {
      responseMessages.debug = {
        content: `\`\`\`\n${JSON.stringify(response, null, 2)}\n\`\`\``,
        allowedMentions: { repliedUser: false, parse: [] },
      };
    }
    return responseMessages;
  } catch (err) {
    L.error(err);
    return {
      error: {
        content: `\n\`\`\`\nERROR: ${err}\n\`\`\``,
        allowedMentions: { repliedUser: false, parse: [] },
      },
    };
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
    .setDescription(
      `A Markov chain chatbot that speaks based on learned messages from previous chat input.`
    )
    .addField(
      `${config.messageCommandPrefix} or /${messageCommand.name}`,
      `Generates a sentence to say based on the chat database. Send your message as TTS to recieve it as TTS.`
    )
    .addField(
      `/${listenChannelCommand.name}`,
      `Add, remove, list, or modify the list of channels the bot listens to.`
    )
    .addField(
      `${config.messageCommandPrefix} train or /${trainCommand.name}`,
      `Fetches the maximum amount of previous messages in the listened to text channels. This takes some time.`
    )
    .addField(
      `${config.messageCommandPrefix} invite or /${inviteCommand.name}`,
      `Post this bot's invite URL.`
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

function generateInviteUrl(): string {
  return client.generateInvite({
    scopes: ['bot', 'applications.commands'],
    permissions: [
      'VIEW_CHANNEL',
      'SEND_MESSAGES',
      'SEND_TTS_MESSAGES',
      'ATTACH_FILES',
      'READ_MESSAGE_HISTORY',
    ],
  });
}

function inviteMessage(): Discord.MessageOptions {
  const avatarURL = client.user.avatarURL() || undefined;
  const inviteUrl = generateInviteUrl();
  const embed = new Discord.MessageEmbed()
    .setAuthor(`Invite ${client.user?.username}`, avatarURL)
    .setThumbnail(avatarURL as string)
    .addField('Invite', `[Invite ${client.user.username} to your server](${inviteUrl})`);
  return { embeds: [embed] };
}

async function handleResponseMessage(
  generatedResponse: GenerateResponse,
  message: Discord.Message
): Promise<void> {
  if (generatedResponse.message) await message.reply(generatedResponse.message);
  if (generatedResponse.debug) await message.reply(generatedResponse.debug);
  if (generatedResponse.error) await message.reply(generatedResponse.error);
}

async function handleUnprivileged(
  interaction: Discord.CommandInteraction | Discord.SelectMenuInteraction,
  deleteReply = true
): Promise<void> {
  if (deleteReply) await interaction.deleteReply();
  await interaction.followUp({ content: INVALID_PERMISSIONS_MESSAGE, ephemeral: true });
}

async function handleNoGuild(
  interaction: Discord.CommandInteraction | Discord.SelectMenuInteraction,
  deleteReply = true
): Promise<void> {
  if (deleteReply) await interaction.deleteReply();
  await interaction.followUp({ content: INVALID_GUILD_MESSAGE, ephemeral: true });
}

client.on('ready', async (readyClient) => {
  L.info({ inviteUrl: generateInviteUrl() }, 'Bot logged in');

  await deployCommands(readyClient.user.id);

  const guildsToSave = readyClient.guilds.valueOf().map((guild) => Guild.create({ id: guild.id }));

  // Remove the duplicate commands
  if (!config.devGuildId) {
    await Promise.all(readyClient.guilds.valueOf().map(async (guild) => guild.commands.set([])));
  }
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
  if (
    !(
      message.guild &&
      (message.channel instanceof Discord.TextChannel ||
        message.channel instanceof Discord.ThreadChannel)
    )
  )
    return;
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
    L.debug('Responding to legacy command');
    const generatedResponse = await generateResponse(message);
    await handleResponseMessage(generatedResponse, message);
  }
  if (command === 'tts') {
    L.debug('Responding to legacy command tts');
    const generatedResponse = await generateResponse(message, { tts: true });
    await handleResponseMessage(generatedResponse, message);
  }
  if (command === 'debug') {
    L.debug('Responding to legacy command debug');
    const generatedResponse = await generateResponse(message, { debug: true });
    await handleResponseMessage(generatedResponse, message);
  }
  if (command === null) {
    if (isHumanAuthoredMessage(message)) {
      if (client.user && message.mentions.has(client.user)) {
        L.debug('Responding to mention');
        // <@!278354154563567636> how are you doing?
        const startSeed = message.content.replace(/<@!\d+>/g, '').trim();
        const generatedResponse = await generateResponse(message, { startSeed });
        await handleResponseMessage(generatedResponse, message);
      }

      if (await isValidChannel(message.channel)) {
        L.debug('Listening');
        const markov = await getMarkovByGuildId(message.channel.guildId);
        await markov.addData([messageToData(message)]);

        //QQ addition (Random Post Generator)
        let RandomChance = Math.random();
        L.debug('Random Chance Try');
        L.debug(RandomChance.toString());
        if (RandomChance <= 0.02) 
        {
          L.debug('Random Chance Pass');
          const generatedResponse = await generateResponse(message);
          await handleResponseMessage(generatedResponse, message);
        }
      }
    }
  }
});

client.on('messageDelete', async (message) => {
  if (!isHumanAuthoredMessage(message)) return;
  if (!(await isValidChannel(message.channel))) return;
  if (!message.guildId) return;

  L.debug(`Deleting message ${message.id}`);
  const markov = await getMarkovByGuildId(message.guildId);
  await markov.removeTags([message.id]);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!isHumanAuthoredMessage(oldMessage)) return;
  if (!(await isValidChannel(oldMessage.channel))) return;
  if (!(oldMessage.guildId && newMessage.content)) return;

  L.debug(`Editing message ${oldMessage.id}`);
  const markov = await getMarkovByGuildId(oldMessage.guildId);
  await markov.removeTags([oldMessage.id]);
  await markov.addData([newMessage.content]);
});

client.on('threadDelete', async (thread) => {
  if (!(await isValidChannel(thread))) return;
  if (!thread.guildId) return;

  L.debug(`Deleting thread messages ${thread.id}`);
  const markov = await getMarkovByGuildId(thread.guildId);
  await markov.removeTags([thread.id]);
});

// eslint-disable-next-line consistent-return
client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    L.info({ command: interaction.commandName }, 'Recieved slash command');

    if (interaction.commandName === helpCommand.name) {
      await interaction.reply(helpMessage());
    } else if (interaction.commandName === inviteCommand.name) {
      await interaction.reply(inviteMessage());
    } else if (interaction.commandName === messageCommand.name) {
      await interaction.deferReply();
      const tts = interaction.options.getBoolean('tts') || false;
      const debug = interaction.options.getBoolean('debug') || false;
      const startSeed = interaction.options.getString('seed')?.trim() || undefined;
      const generatedResponse = await generateResponse(interaction, { tts, debug, startSeed });
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
        if (!isModerator(interaction.member)) {
          return handleUnprivileged(interaction);
        }
        if (!interaction.guildId) {
          return handleNoGuild(interaction);
        }
        const channels = getChannelsFromInteraction(interaction);
        await addValidChannels(channels, interaction.guildId);
        await interaction.editReply(
          `Added ${channels.length} text channels to the list. Use \`/train\` to update the past known messages.`
        );
      } else if (subCommand === 'remove') {
        if (!isModerator(interaction.member)) {
          return handleUnprivileged(interaction);
        }
        if (!interaction.guildId) {
          return handleNoGuild(interaction);
        }
        const channels = getChannelsFromInteraction(interaction);
        await removeValidChannels(channels, interaction.guildId);
        await interaction.editReply(
          `Removed ${channels.length} text channels from the list. Use \`/train\` to remove these channels from the past known messages.`
        );
      } else if (subCommand === 'modify') {
        if (!interaction.guild) {
          return handleNoGuild(interaction);
        }
        if (!isModerator(interaction.member)) {
          await handleUnprivileged(interaction);
        }
        await interaction.deleteReply();
        const dbTextChannels = await getTextChannels(interaction.guild);
        const row = new Discord.MessageActionRow().addComponents(
          new Discord.MessageSelectMenu()
            .setCustomId('listen-modify-select')
            .setPlaceholder('Nothing selected')
            .setMinValues(0)
            .setMaxValues(dbTextChannels.length)
            .addOptions(
              dbTextChannels.map((c) => ({
                label: `#${c.name}` || c.id,
                value: c.id,
                default: c.listen || false,
              }))
            )
        );

        await interaction.followUp({
          content: 'Select which channels you would like to the bot to actively listen to',
          components: [row],
          ephemeral: true,
        });
      }
    } else if (interaction.commandName === trainCommand.name) {
      await interaction.deferReply();
      const reply = (await interaction.fetchReply()) as Discord.Message; // Must fetch the reply ASAP
      const responseMessage = await saveGuildMessageHistory(interaction);
      // Send a message in reply to the reply to avoid the 15 minute webhook token timeout
      await reply.reply({ content: responseMessage });
    }
  } else if (interaction.isSelectMenu()) {
    if (interaction.customId === 'listen-modify-select') {
      await interaction.deferUpdate();
      const { guild } = interaction;
      if (!isModerator(interaction.member)) {
        return handleUnprivileged(interaction, false);
      }
      if (!guild) {
        return handleNoGuild(interaction, false);
      }

      const allChannels =
        (interaction.component as APISelectMenuComponent).options?.map((o) => o.value) || [];
      const selectedChannelIds = interaction.values;

      const textChannels = (
        await Promise.all(
          allChannels.map(async (c) => {
            return guild.channels.fetch(c);
          })
        )
      ).filter((c): c is Discord.TextChannel => c !== null && c instanceof Discord.TextChannel);
      const unselectedChannels = textChannels.filter((t) => !selectedChannelIds.includes(t.id));
      const selectedChannels = textChannels.filter((t) => selectedChannelIds.includes(t.id));
      await addValidChannels(selectedChannels, guild.id);
      await removeValidChannels(unselectedChannels, guild.id);

      await interaction.followUp({
        content: 'Updated actively listened to channels list.',
        ephemeral: true,
      });
    }
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
