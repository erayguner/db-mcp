import { z } from 'zod';
import express, { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';

export const HttpTransportConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(8080),
  host: z.string().default('0.0.0.0'),
  basePath: z.string().default('/mcp'),
  corsOrigins: z.array(z.string()).default(['*']),
  requestTimeoutMs: z.number().default(300000),
  maxRequestBodyBytes: z.number().default(1048576),
});

export type HttpTransportConfig = z.infer<typeof HttpTransportConfigSchema>;

export function createHttpApp(config: HttpTransportConfig): express.Application {
  const app = express();

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // CORS
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const origin = _req.headers.origin;
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Body parser with size limit
  app.use(express.json({ limit: config.maxRequestBodyBytes }));

  // Health endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  app.get('/readiness', (_req: Request, res: Response) => {
    res.json({ ready: true, timestamp: new Date().toISOString() });
  });

  logger.info('HTTP transport app created', {
    basePath: config.basePath,
    port: config.port,
  });

  return app;
}
