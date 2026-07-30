import pino, { type LoggerOptions } from 'pino';
import { getConfig } from '../config/index.js';

/**
 * Single Pino instance for the whole process. Module code should call
 * `logger.child({ module: 'deliveries' })` rather than constructing new
 * root loggers, so log output stays structured and filterable.
 */
/**
 * Quiet by default in `test` unless a level is explicitly requested — tests
 * assert on behavior, not log output, and Fastify's own request logging
 * option for this is deprecated as of Fastify 5 (FSTDEP023), so this is
 * handled here instead of via a per-instance Fastify flag.
 */
const level =
  process.env.LOG_LEVEL ?? (getConfig().NODE_ENV === 'test' ? 'silent' : getConfig().LOG_LEVEL);

const options: LoggerOptions = {
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    remove: true,
  },
};

if (getConfig().NODE_ENV === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  };
}

export const logger = pino(options);

export type Logger = typeof logger;
