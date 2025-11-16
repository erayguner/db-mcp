import winston from 'winston';

/**
 * Structured logging with Winston
 */

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'mcp-bigquery-server' },
  transports: [
    // Console transport - write to stderr for MCP stdio compatibility
    // Per MCP best practices: avoid writing to stdout as it can corrupt JSON-RPC messages
    new winston.transports.Console({
      stderrLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'], // All logs to stderr
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          const { timestamp, level, message, ...meta } = info;
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${String(timestamp)} [${String(level)}]: ${String(message)} ${metaStr}`;
        })
      ),
    }),
  ],
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

export default logger;
