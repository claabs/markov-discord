import 'dotenv/config';
import pino from 'pino';
import PinoPretty from 'pino-pretty';
import { config } from './config';

const logger = pino(
  {
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    level: config.logLevel,
    base: undefined,
  },
  PinoPretty({
    translateTime: `SYS:standard`,
  }),
);

export default logger;
