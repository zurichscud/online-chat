import pino from 'pino';

import { config } from '../config/env';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'shiguang-live-chat' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'authorization', 'req.headers.authorization'],
    censor: '[redacted]',
  },
});
