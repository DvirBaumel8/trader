import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { AppModule } from './app.module.js';
import { ensureDatabaseReady } from './database/startup.js';
import { YahooClient } from './market-data/yahoo.client.js';
import { LlmClient } from './llm/llm.client.js';
import { yahooStub, STUB_EARNINGS, STUB_BARS, STUB_QUOTES } from '../test/yahoo-stub.js';
import { etWeek } from './earnings/week.js';
import { currentSession, previousTradingDay } from './market-data/session.js';

/**
 * The API, for browser tests only.
 *
 * A separate entry point rather than a flag inside `main.ts`, so production
 * carries no branch that swaps a data provider for a fake. Its only
 * differences from the real bootstrap are the stubbed `YahooClient` — which
 * is not optional: every write path creates an instrument from a live quote,
 * so without it the suite would reach the network, assert a different price
 * every day, and fail on a plane. That is
 * the rule `test/offline-guard.ts` enforces for the unit and e2e suites;
 * this is the same rule for the browser suite, applied the only way a real
 * server process allows.
 *
 * Excluded from tsconfig.build.json, so it never reaches the deployed image.
 */
async function bootstrap() {
  await ensureDatabaseReady();

  // Earnings for the Earnings-tab browser spec, relative to the current ET week
  // so it never goes stale: AMD reports before the open on Tuesday, SMCI after
  // the close on Thursday (estimated). 11:00Z and 21:00Z fall on the right side
  // of 09:30/16:00 ET in both EST and EDT.
  const { days } = etWeek(new Date());
  STUB_EARNINGS.AMD = { at: `${days[1]}T11:00:00Z`, estimated: false };
  STUB_EARNINGS.SMCI = { at: `${days[3]}T21:00:00Z`, estimated: true };

  // ATR columns: 25 flat-ish completed sessions (close 100, range 99-101, so
  // ATR% is 2.0) walked back from the current session through the real
  // trading calendar, plus a final session bar and a matching quote. That
  // makes the numbers identical whether the suite runs mid-session, after the
  // close, or on a weekend: NVDA +5.0% (green), AMD -3.0% (red).
  const { asOf } = currentSession(new Date());
  const history: string[] = [];
  for (let d = previousTradingDay(asOf); history.length < 25; d = previousTradingDay(d)) history.unshift(d);
  const flat = history.map((date) => ({ date, open: 100, high: 101, low: 99, close: 100 }));
  const lastBar = (close: number) => ({ date: asOf, open: 100, high: Math.max(100, close) + 1, low: Math.min(100, close) - 1, close });
  STUB_BARS.NVDA = [...flat, lastBar(105)];
  STUB_BARS.AMD = [...flat, lastBar(97)];
  STUB_QUOTES.NVDA = { price: 105, previousClose: 100 };
  STUB_QUOTES.AMD = { price: 97, previousClose: 100 };

  /**
   * Built through the testing module, which is the ONLY way to substitute a
   * provider in a real server process — `NestFactory.create` has no
   * `overrideProvider`. The first version of this file imported the Yahoo
   * stub and never applied it, so the browser suite quietly hit the live
   * Yahoo API and asserted against whatever NVDA happened to cost that
   * minute. Caught by a spec expecting the stub's $200 and seeing $218.29.
   */
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(YahooClient)
    .useValue(yahooStub())
    // No real model in browser tests: map the few messages the specs send to
    // the router's JSON, and everything else to "none" (a prompt).
    .overrideProvider(LlmClient)
    .useValue({
      isConfigured: () => true,
      generateJson: async ({ user }: { user: string }) => {
        if (user === 'bought NVDA') return { action: 'buy', symbols: ['NVDA'] };
        if (user === 'sold NVDA') return { action: 'sell', symbols: ['NVDA'] };
        if (user === 'watch AAPL') return { action: 'watch', symbols: ['AAPL'] };
        if (user === 'Bought: 1. AMD 2. SMCI') return { action: 'buy', symbols: ['AMD', 'SMCI'] };
        return { action: 'none', symbols: [] };
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // The same /api rewrite and static serving main.ts does, so the browser
  // suite exercises the shape production actually runs.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.url.startsWith('/api/health')) {
      req.url = req.url.replace(/^\/api\/health/, '/health');
    }
    next();
  });
  app.setGlobalPrefix('api', { exclude: ['health', 'health/ping'] });

  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (existsSync(frontendDist)) {
    expressApp.use(express.static(frontendDist));
    expressApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  await app.listen(Number(process.env.PORT ?? 3010), '127.0.0.1');
  console.log(`[trader e2e] listening on ${process.env.PORT ?? 3010}`);
}

void bootstrap();
