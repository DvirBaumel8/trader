import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestLoggingMiddleware } from './request-logging.middleware.js';

function run(path: string, status: number, ms = 5) {
  vi.useFakeTimers();
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  new RequestLoggingMiddleware().use({ method: 'GET', baseUrl: '', path } as never, res as never, () => {});
  vi.advanceTimersByTime(ms);
  res.emit('finish');
  return { log, warn };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('RequestLoggingMiddleware', () => {
  it('logs an ordinary request', () => {
    const { log } = run('/watchlist/daily-brief', 200);
    expect(log).toHaveBeenCalledWith('GET /watchlist/daily-brief 200 5ms');
  });

  it('stays quiet for a healthy health ping, which Render sends every few seconds', () => {
    const { log, warn } = run('/health/ping', 200);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(run('/api/health/ping', 304).log).not.toHaveBeenCalled();
  });

  it('still logs a failing health ping', () => {
    expect(run('/health/ping', 503).log).toHaveBeenCalledWith('GET /health/ping 503 5ms');
  });

  it('still warns on a slow health ping', () => {
    expect(run('/health/ping', 200, 1500).warn).toHaveBeenCalledWith('GET /health/ping 200 1500ms  SLOW');
  });
});
