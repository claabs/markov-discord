# Changelog

All notable changes to this project will be documented in this file.

## Versions

### 2.0.0

#### Breaking Changes

* Config option `prefix` renamed to `messageCommandPrefix`
* Config option `game` renamed to `activity`
* Docker internal volume path moved from `/usr/src/markbot/config` to `/usr/app/config`
* Database changed from JSON files to a SQLite database. You'll need to retrain the bot to use it again.
* The bot must be explicitly granted permission to listen to a list of channels before using it. Configure it with `/listen`.
* Docker user changed from `root` to `node`

#### New Features

* Data is stored in a relational database to reduce memory and disk read/write usage, as well as to decrease latency
* The bot can be restricted to only learn/listen from a strict list of channels
* Bot responses can be seeded by a short phrase
* Discord slash command support
* Many more config options available at <https://claabs.github.io/markov-discord/classes/AppConfig.html>
* Config file supports [JSON5](https://json5.org/) (comments, trailing commas, etc)
* Generated responses will now never ping a user or role, only just highlight their name

### 0.7.3

* Fix crash when fetched messages is empty
* Update docs
* Update dependencies

### 0.7.2

* Fix @everyone replacement

### 0.7.1

* Readme updates
* Config loading fix
* Fix min score
* Add generator options to config
* Document Node 12 update

### 0.7.0

* Convert project to Typescript
* Optimize Docker build (smaller image)
* Load corpus from filesystem to reduce memory load

### 0.6.2

* Fix MarkovDB not loading on boot

### 0.6.1

* Fix bot crashing on scheduled regen

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
