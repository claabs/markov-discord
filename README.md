# MarkBot for Discord
This is a super rough prototype. A Markov chain bot using markov-strings. Just uploading here so it can run and generate training data.

# Setup

## Configuration
Create a file called `config.json` in the project directory with the contents:
```
{
  "prefix":"!mark",
  "game":"\"!mark help\" for help",
  "token":"k5NzE2NDg1MTIwMjc0ODQ0Nj.DSnXwg.ttNotARealToken5p3WfDoUxhiH"
}
```

## Changelog
### 0.4.0
Huge refactor. 
Added `!mark debug` which sends debug info alongside the message.
Converted the fetchMessages function to async/await (updating the requirement to Node.js 8).
Updated module versions.
Added faster unique-array-by-property function
Added linting and linted the project. 

### 0.3.0
Added TTS support and random message attachments.
Deleted messages no longer persist in the database longer than 24 hours.

### 0.2.0
Updated training algorithm and data structure.