import pino from 'pino';
import dotenv from 'dotenv';
import { config } from './config';

dotenv.config();

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      translateTime: `SYS:standard`,
    },
  },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  level: config.logLevel,
  base: undefined,
});

export default logger;
