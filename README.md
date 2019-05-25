# MarkBot for Discord
A Markov chain bot using markov-strings.

# Setup
First, create a [Discord bot application](https://discordapp.com/developers/applications/).
## Windows
### Requirements
* [Node.js 8.0+ (Current)](https://nodejs.org/en/download/current/)

### Setup
1. Install Node.js 8.0 or newer.
1. Download this repository using git in a command prompt
    ```cmd
    git clone https://github.com/charlocharlie/markov-discord.git
    ```
    or by just downloading and extracting the [project zip](https://github.com/charlocharlie/markov-discord/archive/master.zip) from GitHub.
1. Open a command prompt in the `markov-discord` folder.
    ```sh
    # Install Windows build tools
    npm install --global --production windows-build-tools
    # NPM install non-development packages
    npm install --production
    ```
1. Create a file called `config.json` in the project directory with the contents:
    ```json
    {
      "prefix":"!mark",
      "game":"\"!mark help\" for help",
      "token":"k5NzE2NDg1MTIwMjc0ODQ0Nj.DSnXwg.ttNotARealToken5p3WfDoUxhiH"
    }
    ```
    Feel free to change the command prefix, game display. Add your bot token.
1. Run the bot:
    ```sh
    npm start
    ```


## Debian Linux
### Requirements
* Node.js 8.0+
* Python 2.7 (for erlpack)
* C++ build tools (for erlpack)

### Download
```sh
# Clone this repository
git clone https://github.com/charlocharlie/markov-discord.git
cd markov-discord
```

### Configure
Create a file called `config.json` in the project directory with the contents:
```json
{
  "prefix":"!mark",
  "game":"\"!mark help\" for help",
  "token":"k5NzE2NDg1MTIwMjc0ODQ0Nj.DSnXwg.ttNotARealToken5p3WfDoUxhiH"
}
```
Feel free to change the command prefix, game display. Add your bot token.

### Install and Run
```sh
# Install Node.js if you haven't already
wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.33.11/install.sh | bash
nvm install node

# NPM install non-development packages
npm install --production

# If you run into build errors, install the following packages:
sudo apt-get install python -y
sudo apt-get install build-essential -y

# Start the program
npm start
```

## Docker
### Setup with source
1. Install Docker for your OS.
1. Download this repository using git in a command prompt
    ```sh
    git clone https://github.com/charlocharlie/markov-discord.git
    ```
    or by just downloading and extracting the [project zip](https://github.com/charlocharlie/markov-discord/archive/master.zip) from GitHub.
1. Open a command prompt in the markov-discord folder and run this one-liner:
    ```sh
    docker run --rm -e TOKEN=YOUR.BOT.TOKEN -v config:/usr/src/markbot/config -it $(docker build -q .)
    # Be patient as the build output is suppressed
    ```

### Setup with Docker Hub image
1. Install Docker for your OS.
1. Open a command prompts and run this one-liner:
    ```sh
    docker build https://github.com/charlocharlie/markov-discord.git 
    ```



# Changelog
### 0.6.0
* Added Docker deploy functionality.
* Moved config and database to `./config` directory. Existing configs will be migrated.
* Config-less support via bot token located in an environment variable.
* Update dependencies.
* Change corpus regen time to 4 AM.

### 0.5.0
* Fixed bug where `!mark help` didn't work.
* Only admins can train.
* The bot responds when mentioned.
* The bot cannot mention @everyone.
* Added version number to help.
* Added `!mark tts` for a quieter TTS response.
* Readme overhaul.
* Simpler config loading.

### 0.4.0
* Huge refactor. 
* Added `!mark debug` which sends debug info alongside the message.
* Converted the fetchMessages function to async/await (updating the requirement to Node.js 8).
* Updated module versions.
* Added faster unique-array-by-property function
* Added linting and linted the project. 

### 0.3.0
* Added TTS support and random message attachments.
* Deleted messages no longer persist in the database longer than 24 hours.

### 0.2.0
* Updated training algorithm and data structure.

# Thanks
Thanks to [BotMaker-for-Discord](https://github.com/CorySanin/BotMaker-for-Discord) which I used as a reference when during development. 