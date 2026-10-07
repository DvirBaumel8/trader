import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * One line per request: method, path, status, duration.
 *
 * Added because "updating a stop took too long" could not be answered from
 * the logs at all — they carried startup and route mapping and nothing else,
 * so diagnosing it meant reproducing the call by hand against the compiled
 * app. A slow request the owner actually made should leave a trace.
 *
 * Only slow requests are logged at `warn`, so the normal case stays quiet and
 * a real stall stands out in `logs/api.log` without anyone grepping for it.
 */
const SLOW_MS = 1000;

/**
 * Render's health check and the keep-warm Worker hit this every few seconds;
 * logged, it buried every real request. A slow or failing ping is still
 * logged — that is the one that says something is wrong.
 */
const QUIET_PATHS = new Set(['/health/ping', '/api/health/ping']);

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly log = new Logger('Request');

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = Date.now();

    // 'finish' rather than wrapping res.end: it fires once the response is
    // actually flushed, which is the number the owner experiences, and it
    // still fires when a handler throws.
    res.once('finish', () => {
      const ms = Date.now() - startedAt;
      // The path only — never the query string. Filters carry search text,
      // and a log is the wrong place for what he was looking for.
      const path = req.baseUrl || req.path;
      const line = `${req.method} ${path} ${res.statusCode} ${ms}ms`;
      if (ms >= SLOW_MS) this.log.warn(`${line}  SLOW`);
      else if (QUIET_PATHS.has(path) && res.statusCode < 400) return;
      else this.log.log(line);
    });

    next();
  }
}
