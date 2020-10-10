/* eslint-disable no-console */
import 'source-map-support/register';
import * as Discord from 'discord.js';
// https://discord.js.org/#/docs/main/stable/general/welcome
import * as fs from 'fs';

import Markov, {
  MarkovGenerateOptions,
  MarkovResult,
  MarkovConstructorOptions,
} from 'markov-strings';

import * as schedule from 'node-schedule';

interface MessageRecord {
  id: string;
  string: string;
  attachment?: string;
}

interface MarkbotMarkovResult extends MarkovResult {
  refs: Array<MessageRecord>;
}

interface MessagesDB {
  messages: MessageRecord[];
}

interface MarkbotConfig {
  stateSize?: number;
  minScore?: number;
  maxTries?: number;
  prefix?: string;
  game?: string;
  token?: string;
}

const version: string = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version || '0.0.0';

const client = new Discord.Client();
// const ZEROWIDTH_SPACE = String.fromCharCode(parseInt('200B', 16));
// const MAXMESSAGELENGTH = 2000;

const PAGE_SIZE = 100;
// let guilds = [];
// let connected = -1;
let GAME = '!mark help';
let PREFIX = '!mark';
let STATE_SIZE = 2; // Value of 1 to 3, based on corpus quality
let MAX_TRIES = 1000;
let MIN_SCORE = 10;
const inviteCmd = 'invite';
const errors: string[] = [];

let fileObj: MessagesDB = {
  messages: [],
};

let markovDB: MessageRecord[] = [];
let messageCache: MessageRecord[] = [];
let deletionCache: string[] = [];
let markovOpts: MarkovConstructorOptions = {
  stateSize: STATE_SIZE,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function uniqueBy<Record extends { [key: string]: any }>(
  arr: Record[],
  propertyName: keyof Record
): Record[] {
  const unique: Record[] = [];
  const found: { [key: string]: boolean } = {};

  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i][propertyName]) {
      const value = arr[i][propertyName];
      if (!found[value]) {
        found[value] = true;
        unique.push(arr[i]);
      }
    }
  }
  return unique;
}

/**
 * Regenerates the corpus and saves all cached changes to disk
 */
function regenMarkov(): void {
  console.log('Regenerating Markov corpus...');
  try {
    fileObj = JSON.parse(fs.readFileSync('config/markovDB.json', 'utf8'));
  } catch (err) {
    console.log('No markovDB.json, starting with initial values');
    fileObj = {
      messages: [
        {
          id: '0',
          string: '',
        },
      ],
    };
  }
  // console.log("MessageCache", messageCache)
  markovDB = fileObj.messages;
  markovDB = uniqueBy<MessageRecord>(markovDB.concat(messageCache), 'id');
  deletionCache.forEach(id => {
    const removeIndex = markovDB.map(item => item.id).indexOf(id);
    // console.log('Remove Index:', removeIndex)
    markovDB.splice(removeIndex, 1);
  });
  deletionCache = [];
  const markov = new Markov(markovDB, markovOpts);
  fileObj.messages = markovDB;
  // console.log("WRITING THE FOLLOWING DATA:")
  // console.log(fileObj)
  fs.writeFileSync('config/markovDB.json', JSON.stringify(fileObj), 'utf-8');
  fileObj.messages = [];
  messageCache = [];
  markov.buildCorpus();
  fs.writeFileSync('config/markov.json', JSON.stringify(markov));
  console.log('Done regenerating Markov corpus.');
}

/**
 * Loads the config settings from disk
 */
function loadConfig(): void {
  // Move config if in legacy location
  if (fs.existsSync('./config.json')) {
    console.log('Copying config.json to new location in ./config');
    fs.renameSync('./config.json', './config/config.json');
  }

  if (fs.existsSync('./markovDB.json')) {
    console.log('Copying markovDB.json to new location in ./config');
    fs.renameSync('./markovDB.json', './config/markovDB.json');
  }

  let token = 'missing';
  try {
    const cfg: MarkbotConfig = JSON.parse(fs.readFileSync('./config/config.json', 'utf8'));
    PREFIX = cfg.prefix || '!mark';
    GAME = cfg.game || '!mark help';
    token = cfg.token || process.env.TOKEN || token;
    STATE_SIZE = cfg.stateSize || STATE_SIZE;
    MIN_SCORE = cfg.minScore || MIN_SCORE;
    MAX_TRIES = cfg.maxTries || MAX_TRIES;
  } catch (e) {
    console.warn('Failed to read config.json.');
    token = process.env.TOKEN || token;
  }
  try {
    client.login(token);
  } catch (e) {
    console.error('Failed to login with token:', token);
  }
  markovOpts = {
    stateSize: STATE_SIZE,
  };
}

/**
 * Checks if the author of a message as moderator-like permissions.
 * @param {GuildMember} member Sender of the message
 * @return {Boolean} True if the sender is a moderator.
 */
function isModerator(member: Discord.GuildMember): boolean {
  return (
    member.hasPermission('ADMINISTRATOR') ||
    member.hasPermission('MANAGE_CHANNELS') ||
    member.hasPermission('KICK_MEMBERS') ||
    member.hasPermission('MOVE_MEMBERS') ||
    member.id === '82684276755136512' // charlocharlie#8095
  );
}

/**
 * Reads a new message and checks if and which command it is.
 * @param {Message} message Message to be interpreted as a command
 * @return {String} Command string
 */
function validateMessage(message: Discord.Message): string | null {
  const messageText = message.content.toLowerCase();
  let command = null;
  const thisPrefix = messageText.substring(0, PREFIX.length);
  if (thisPrefix === PREFIX) {
    const split = messageText.split(' ');
    if (split[0] === PREFIX && split.length === 1) {
      command = 'respond';
    } else if (split[1] === 'train') {
      command = 'train';
    } else if (split[1] === 'help') {
      command = 'help';
    } else if (split[1] === 'regen') {
      command = 'regen';
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

/**
 * Function to recursively get all messages in a text channel's history. Ends
 * by regnerating the corpus.
 * @param {Message} message Message initiating the command, used for getting
 * channel data
 */
async function fetchMessages(message: Discord.Message): Promise<void> {
  let historyCache: MessageRecord[] = [];
  let keepGoing = true;
  let oldestMessageID: string | undefined;

  while (keepGoing) {
    const messages: Discord.Collection<
      string,
      Discord.Message
      // eslint-disable-next-line no-await-in-loop
    > = await message.channel.fetchMessages({
      before: oldestMessageID,
      limit: PAGE_SIZE,
    });
    const nonBotMessageFormatted = messages
      .filter(elem => !elem.author.bot)
      .map(elem => {
        const dbObj: MessageRecord = {
          string: elem.content,
          id: elem.id,
        };
        if (elem.attachments.size > 0) {
          dbObj.attachment = elem.attachments.values().next().value.url;
        }
        return dbObj;
      });
    historyCache = historyCache.concat(nonBotMessageFormatted);
    if (!messages.last() || messages.size < PAGE_SIZE) {
      keepGoing = false;
    } else {
      oldestMessageID = messages.last().id;
    }
  }
  console.log(`Trained from ${historyCache.length} past human authored messages.`);
  messageCache = messageCache.concat(historyCache);
  regenMarkov();
  message.reply(`Finished training from past ${historyCache.length} messages.`);
}

/**
 * General Markov-chain response function
 * @param {Message} message The message that invoked the action, used for channel info.
 * @param {Boolean} debug Sends debug info as a message if true.
 * @param {Boolean} tts If the message should be sent as TTS. Defaults to the TTS setting of the
 * invoking message.
 */
function generateResponse(message: Discord.Message, debug = false, tts = message.tts): void {
  console.log('Responding...');
  const options: MarkovGenerateOptions = {
    filter: (result): boolean => {
      return result.score >= MIN_SCORE;
    },
    maxTries: MAX_TRIES,
  };

  const fsMarkov = new Markov([''], markovOpts);
  const markovFile = JSON.parse(fs.readFileSync('config/markov.json', 'utf-8')) as Markov;
  fsMarkov.corpus = markovFile.corpus;
  fsMarkov.startWords = markovFile.startWords;
  fsMarkov.endWords = markovFile.endWords;

  try {
    const myResult = fsMarkov.generate(options) as MarkbotMarkovResult;
    console.log('Generated Result:', myResult);
    const messageOpts: Discord.MessageOptions = { tts };
    const attachmentRefs = myResult.refs
      .filter(ref => Object.prototype.hasOwnProperty.call(ref, 'attachment'))
      .map(ref => ref.attachment as string);
    if (attachmentRefs.length > 0) {
      const randomRefAttachment = attachmentRefs[Math.floor(Math.random() * attachmentRefs.length)];
      messageOpts.files = [randomRefAttachment];
    } else {
      const randomMessage = markovDB[Math.floor(Math.random() * markovDB.length)];
      if (randomMessage.attachment) {
        messageOpts.files = [{ attachment: randomMessage.attachment }];
      }
    }

    myResult.string = myResult.string.replace(/@everyone/g, '@everyοne'); // Replace @everyone with a homoglyph 'o'
    message.channel.send(myResult.string, messageOpts);
    if (debug) message.channel.send(`\`\`\`\n${JSON.stringify(myResult, null, 2)}\n\`\`\``);
  } catch (err) {
    console.log(err);
    if (debug) message.channel.send(`\n\`\`\`\nERROR: ${err}\n\`\`\``);
    if (err.message.includes('Cannot build sentence with current corpus')) {
      console.log('Not enough chat data for a response.');
    }
  }
}

client.on('ready', () => {
  console.log('Markbot by Charlie Laabs');
  client.user.setActivity(GAME);
  regenMarkov();
});

client.on('error', err => {
  const errText = `ERROR: ${err.name} - ${err.message}`;
  console.log(errText);
  errors.push(errText);
  fs.writeFile('./config/error.json', JSON.stringify(errors), fsErr => {
    if (fsErr) {
      console.log(`error writing to error file: ${fsErr.message}`);
    }
  });
});

client.on('message', message => {
  if (message.guild) {
    const command = validateMessage(message);
    if (command === 'help') {
      const richem = new Discord.RichEmbed()
        .setAuthor(client.user.username, client.user.avatarURL)
        .setThumbnail(client.user.avatarURL)
        .setDescription('A Markov chain chatbot that speaks based on previous chat input.')
        .addField(
          '!mark',
          'Generates a sentence to say based on the chat database. Send your ' +
            'message as TTS to recieve it as TTS.'
        )
        .addField(
          '!mark train',
          'Fetches the maximum amount of previous messages in the current ' +
            'text channel, adds it to the database, and regenerates the corpus. Takes some time.'
        )
        .addField(
          '!mark regen',
          'Manually regenerates the corpus to add recent chat info. Run ' +
            'this before shutting down to avoid any data loss. This automatically runs at midnight.'
        )
        .addField(
          '!mark invite',
          "Don't invite this bot to other servers. The database is shared " +
            'between all servers and text channels.'
        )
        .addField('!mark debug', 'Runs the !mark command and follows it up with debug info.')
        .setFooter(`Markov Discord v${version} by Charlie Laabs`);
      message.channel.send(richem).catch(() => {
        message.author.send(richem);
      });
    }
    if (command === 'train') {
      if (isModerator(message.member)) {
        console.log('Training...');
        fileObj = {
          messages: [],
        };
        fs.writeFileSync('config/markovDB.json', JSON.stringify(fileObj), 'utf-8');
        fetchMessages(message);
      }
    }
    if (command === 'respond') {
      generateResponse(message);
    }
    if (command === 'tts') {
      generateResponse(message, false, true);
    }
    if (command === 'debug') {
      generateResponse(message, true);
    }
    if (command === 'regen') {
      regenMarkov();
    }
    if (command === null) {
      console.log('Listening...');
      if (!message.author.bot) {
        const dbObj: MessageRecord = {
          string: message.content,
          id: message.id,
        };
        if (message.attachments.size > 0) {
          dbObj.attachment = message.attachments.values().next().value.url;
        }
        messageCache.push(dbObj);
        if (message.isMentioned(client.user)) {
          generateResponse(message);
        }
      }
    }
    if (command === inviteCmd) {
      const richem = new Discord.RichEmbed()
        .setAuthor(`Invite ${client.user.username}`, client.user.avatarURL)
        .setThumbnail(client.user.avatarURL)
        .addField(
          'Invite',
          `[Invite ${client.user.username} to your server](https://discordapp.com/oauth2/authorize?client_id=${client.user.id}&scope=bot)`
        );

      message.channel.send(richem).catch(() => {
        message.author.send(richem);
      });
    }
  }
});

client.on('messageDelete', message => {
  // console.log('Adding message ' + message.id + ' to deletion cache.')
  deletionCache.push(message.id);
  console.log('deletionCache:', deletionCache);
});

loadConfig();
schedule.scheduleJob('0 4 * * *', () => regenMarkov());
