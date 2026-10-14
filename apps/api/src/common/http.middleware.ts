import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID = /^[\w-]{1,64}$/;
const logger = new Logger('Http');

/**
 * Marks every API response uncacheable and logs one line per request. The line carries only
 * method, route pattern, status, duration and request id: never query strings, bodies, cookies
 * or tokens.
 */
export function httpMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const header = req.headers['x-request-id'];
  const requestId = typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => {
    const route = (req.route as { path?: string } | undefined)?.path;
    logger.log({
      requestId,
      method: req.method,
      route: route ? `${req.baseUrl}${route}` : 'unmatched',
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1000n) / 1000,
    });
  });
  next();
}
