const Discord = require('discord.js') //https://discord.js.org/#/docs/main/stable/general/welcome
const fs = require('fs')
const Markov = require('markov-strings')
const uniqueBy = require('unique-by');
const schedule = require('node-schedule');
const client = new Discord.Client()
const ZEROWIDTH_SPACE = String.fromCharCode(parseInt('200B', 16))
const MAXMESSAGELENGTH = 2000



let guilds = []
let connected = -1
let GAME = 'GAME'
let BOTDESC = 'Amazing.'
let PREFIX = '! '
let VOLUME
let inviteCmd = 'invite'
let commands = {}
let aliases = {}
let errors = []

let fileObj = {
  messages: []
}

let markovDB = []
let messageCache = []
let deletionCache = []
const markovOpts = {
  maxLength: 400,
  minWords: 3,
  minScore: 10
}
let markov
// let markov = new Markov(markovDB, markovOpts);

function regenMarkov() {
  console.log("Regenerating Markov corpus...")
  try {
    fileObj = JSON.parse(fs.readFileSync('markovDB.json', 'utf8'))
  }
  catch (err) { console.log(err) }
  // console.log("MessageCache", messageCache)
  markovDB = fileObj.messages
  markovDB = uniqueBy(markovDB.concat(messageCache), 'id')
  deletionCache.forEach(id => {
    let removeIndex = markovDB.map(function (item) { return item.id; }).indexOf(id)
    // console.log('Remove Index:', removeIndex)
    markovDB.splice(removeIndex, 1)
  })
  deletionCache = []
  if (markovDB.length == 0)
    markovDB.push({ string: 'hello', id: null })
  markov = new Markov(markovDB, markovOpts);
  markov.buildCorpusSync()
  fileObj.messages = markovDB
  // console.log("WRITING THE FOLLOWING DATA:")
  // console.log(fileObj)
  fs.writeFileSync('markovDB.json', JSON.stringify(fileObj), 'utf-8')
  fileObj = null;
  // markovDB = []
  messageCache = []
  console.log("Done regenerating Markov corpus.")
}

function loadConfig() {
  let cfgfile = 'config.json'
  if (fs.existsSync(cfgfile)) {
    let cfg = JSON.parse(fs.readFileSync(cfgfile, 'utf8'))
    PREFIX = cfg.prefix
    GAME = cfg.game
    BOTDESC = cfg.description
    inviteCmd = cfg.invitecmd
    //regenMarkov()
    client.login(cfg.token)
  }
  else {
    console.log('Oh no!!! ' + cfgfile + ' could not be found!')
  }
}

client.on('ready', () => {
  console.log('Markbot by Charlie Laabs')
  client.user.setActivity(GAME)
})

client.on('error', (err) => {
  let errText = 'ERROR: ' + err.name + ' - ' + err.message
  console.log(errText)
  errors.push(errText)
  fs.writeFile('error.json', JSON.stringify(errors), function (err) {
    if (err)
      console.log('error writing to error file: ' + err.message)
  })
})

client.on('message', message => {
  if (message.guild) {
    let command = validateMessage(message)
    if (command === 'help') {
      let richem = new Discord.RichEmbed()
        .setAuthor(client.user.username, client.user.avatarURL)
        .setThumbnail(client.user.avatarURL)
        .setDescription('A Markov chain chatbot that speaks based on previous chat input.')
        .addField('!mark', 'Generates a sentence to say based on the chat database. Send your message as TTS to recieve it as TTS.')
        .addField('!mark train', 'Fetches the maximum amount of previous messages in the current text channel, adds it to the database, and regenerates the corpus. Takes about 2 minutes.')
        .addField('!mark regen', 'Manually regenerates the corpus to add recent chat info. Run this before shutting down to avoid any data loss. This automatically runs at midnight.')
        .addField('!mark invite', 'Don\'t invite this bot to other servers. The database is shared between all servers and text channels.')
      message.channel.send(richem)
        .catch(reason => {
          message.author.send(richem)
        })
    }
    if (command === 'train') {
      console.log("Training...")
      fileObj = {
        messages: []
      }
      fs.writeFileSync('markovDB.json', JSON.stringify(fileObj), 'utf-8')
      fetchMessageChunk(message, null, [])
    }
    if (command === 'respond') {
      console.log("Responding...")
      markov.generateSentence().then(result => {
        console.log('Generated Result:', result)
        let messageOpts = {
          tts: message.tts
        }
        let randomMessage = markovDB[Math.floor(Math.random() * markovDB.length)]
        console.log('Random Message:', randomMessage)
        if (randomMessage.hasOwnProperty('attachment')) {
          messageOpts.files = [{
            attachment: randomMessage.attachment
          }]
        }
        message.channel.send(result.string, messageOpts)
      }).catch(err => {
        console.log(err)
        if (err.message == 'Cannot build sentence with current corpus and options')
          // message.reply('Not enough chat data for a response. Run `!mark train` to process past messages.')
          console.log('Not enough chat data for a response.')
      })
    }
    if (command === 'regen') {
      console.log("Regenerating...")
      regenMarkov()
    }
    if (command === null) {
      console.log("Listening...")
      if (!message.author.bot) {
        let dbObj = {
          string: message.content,
          id: message.id
        }
        if (message.attachments.size > 0) {
          dbObj.attachment = message.attachments.values().next().value.url
        }
        messageCache.push(dbObj)
      }
    }
    if (command === inviteCmd) {
      let richem = new Discord.RichEmbed()
        .setAuthor('Invite ' + client.user.username, client.user.avatarURL)
        .setThumbnail(client.user.avatarURL)
        .addField('Invite', "[Invite " + client.user.username + " to your server](https://discordapp.com/oauth2/authorize?client_id=" + client.user.id + "&scope=bot)")

      message.channel.send(richem)
        .catch(reason => {
          message.author.send(richem)
        })
    }
  }
})

client.on('messageDelete', message => {
  // console.log('Adding message ' + message.id + ' to deletion cache.')
  deletionCache.push(message.id)
  console.log('deletionCache:', deletionCache)
})

function validateMessage(message) {
  let messageText = message.content.toLowerCase()
  let command = null;
  let thisPrefix = messageText.substring(0, PREFIX.length)
  if (thisPrefix == PREFIX) {
    let split = messageText.split(" ")
    if (split[0] == PREFIX && split.length == 1)
      command = 'respond'
    else if (split[1] == 'train')
      command = 'train'
    else if (split[1] == 'help')
      command = 'help'
    else if (split[1] == 'regen')
      command = 'regen'
    else if (split[1] == 'invite')
      command = 'invite'
  }
  return command
}

function fetchMessageChunk(message, oldestMessageID, historyCache) {
  message.channel.fetchMessages({ before: oldestMessageID, limit: 100 })
    .then(messages => {
      historyCache = historyCache.concat(messages.filter(elem => !elem.author.bot).map(elem => {
        let dbObj = {
          string: elem.content,
          id: elem.id
        }
        if (elem.attachments.size > 0) {
          dbObj.attachment = elem.attachments.values().next().value.url
        }
        return dbObj
      }));
      oldestMessageID = messages.last().id
      return historyCache.concat(fetchMessageChunk(message, oldestMessageID, historyCache))
    }).catch(err => {
      console.log("Trained from " + historyCache.length + " past messages.")
      messageCache = messageCache.concat(historyCache)
      regenMarkov()
      message.reply('Finished training from past ' + historyCache.length + ' messages.')
    });
}

loadConfig()
const daily = schedule.scheduleJob('0 0 * * *', regenMarkov());
