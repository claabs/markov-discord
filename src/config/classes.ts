/* eslint-disable @typescript-eslint/no-empty-function, no-useless-constructor, max-classes-per-file */
import 'reflect-metadata';
import { Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsArray, IsInt, IsDefined } from 'class-validator';

export enum LogLevel {
  SILENT = 'silent',
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace',
}

/**
 * @example ```jsonc
 * {
 *   "token": "k5NzE2NDg1MTIwMjc0ODQ0Nj.DSnXwg.ttNotARealToken5p3WfDoUxhiH",
 *   "commandPrefix": "!mark",
 *   "activity": "\"!mark help\" for help",
 *   "ownerIds": ["00000000000000000"],
 *   "logLevel": "info",
 * }
 * ```
 */
export class AppConfig {
  /**
   * Your Discord bot token
   * @example k5NzE2NDg1MTIwMjc0ODQ0Nj.DSnXwg.ttNotARealToken5p3WfDoUxhiH
   * @env TOKEN
   */
  @IsDefined()
  @IsString()
  token = process.env.TOKEN as string;

  /**
   * The command prefix used to trigger the bot commands (when not using slash commands)
   * @example !bot
   * @default !mark
   * @env CRON_SCHEDULE
   */
  @IsOptional()
  @IsString()
  commandPrefix = process.env.COMMAND_PREFIX || '!mark';

  /**
   * The activity status shown under the bot's name in the user list
   * @example "!mark help" for help
   * @default !mark help
   * @env ACTIVITY
   */
  @IsOptional()
  @IsString()
  activity = process.env.ACTIVITY || '!mark help';

  /**
   * A list of Discord user IDs that have owner permissions for the bot
   * @example ['82684276755136512']
   * @default []
   * @env OWNER_IDS (comma separated)
   */
  @IsArray()
  @IsString({ each: true })
  @Type(() => String)
  @IsOptional()
  ownerIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',').map((id) => id.trim()) : [];

  /**
   * TZ name from this list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones#List
   * @example America/Chicago
   * @default UTC
   * @env TZ
   */
  @IsOptional()
  @IsString()
  timezone = process.env.TZ || 'UTC';

  /**
   * Log level in lower case. Can be [silent, error, warn, info, debug, trace]
   * @example debug
   * @default info
   * @env LOG_LEVEL
   */
  @IsOptional()
  @IsEnum(LogLevel)
  logLevel = process.env.LOG_LEVEL || LogLevel.INFO;

  /**
   * The stateSize is the number of words for each "link" of the generated sentence.
   * 1 will output gibberish sentences without much sense.
   * 2 is a sensible default for most cases.
   * 3 and more can create good sentences if you have a corpus that allows it.
   * @example 3
   * @default 2
   * @env STATE_SIZE
   */
  @IsOptional()
  @IsInt()
  stateSize = process.env.STATE_SIZE ? parseInt(process.env.STATE_SIZE, 10) : 2;

  /**
   * The number of tries the sentence generator will try before giving up
   * @example 2000
   * @default 1000
   * @env MAX_TRIES
   */
  @IsOptional()
  @IsInt()
  maxTries = process.env.MAX_TRIES ? parseInt(process.env.MAX_TRIES, 10) : 1000;

  /**
   * The minimum score required when generating a sentence.
   * A relative "score" based on the number of possible permutations.
   * Higher is "better", but the actual value depends on your corpus.
   * @example 15
   * @default 10
   * @env MIN_SCORE
   */
  @IsOptional()
  @IsInt()
  minScore = process.env.MIN_SCORE ? parseInt(process.env.MIN_SCORE, 10) : 10;

  /**
   * This guild ID should be declared if you want its commands to update immediately during development
   * @example 1234567890
   * @env DEV_GUILD_ID
   */
  @IsOptional()
  @IsString()
  devGuildId = process.env.DEV_GUILD_ID;
}
