const Discord = require('discord.js') //https://discord.js.org/#/docs/main/stable/general/welcome
const fs = require('fs')
const Markov = require('markov-strings')
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

let lastSeenMessageID = null
let fileObj = {
  messages: [],
  lastSeenMessageID: null
}

let markovDB = []
let messageCache = []
const markovOpts = {
  maxLength: 400,
  minWords: 3,
  minScore: 5
}
let markov = new Markov(markovDB, markovOpts);

function regenMarkov() {
  console.log("Regenerating Markov corpus...")
  try {
    fileObj = JSON.parse(fs.readFileSync('markovDB.json', 'utf8'))
  }
  catch (err) { console.log(err) }
  // console.log("MessageCache", messageCache)
  markovDB = fileObj.messages
  if (markovDB.length == 0)
    markovDB.push("hello")
  markovDB = markovDB.concat(messageCache)
  markov = new Markov(markovDB, markovOpts);
  markov.buildCorpusSync()
  fileObj.messages = markovDB
  fileObj.lastSeenMessageID = lastSeenMessageID
  // console.log("WRITING THE FOLLOWING DATA:")
  // console.log(fileObj)
  fs.writeFileSync('markovDB.json', JSON.stringify(fileObj), 'utf-8')
  fileObj = null;
  markovDB = []
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
    client.login(cfg.token)
  }
  else {
    console.log('Oh no!!! ' + cfgfile + ' could not be found!')
  }
}

client.on('ready', () => {
  console.log('Markbot by Charlie Laabs')
  try { lastSeenMessageID = JSON.parse(fs.readFileSync('markovDB.json', 'utf8')).lastSeenMessageID }
  catch (err) { console.log(err) }
  regenMarkov()
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
    // if (command === 'help') {
    //   I should probably add a help message sometime
    // }
    if (command === 'train') {
      console.log("Training...")
      message.channel.fetchMessages({ after: lastSeenMessageID, limit: 100 })
        .then(messages => {
          messages.forEach(value => {
            messageCache.push(value.content)
          })
          regenMarkov()
        }).catch(console.error)
    }
    if (command === 'respond') {
      console.log("Responding...")
      markov.generateSentence().then(result => {
        console.log(result)
        message.channel.send(result.string)
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
      messageCache.push(message.content)
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
    lastSeenMessageID = message.id
  }
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

loadConfig()
