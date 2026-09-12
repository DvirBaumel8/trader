import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { AppModule } from './app.module.js';
import { ensureDatabaseReady } from './database/startup.js';
import { YahooClient } from './market-data/yahoo.client.js';
import { yahooStub } from '../test/yahoo-stub.js';
import { LlmClient } from './llm/llm.client.js';

/**
 * A fixed model answer, in the exact `[RANK]` format `parseRanking` reads
 * (see `llm/watchlist-ranking-prompt.ts`'s OUTPUT CONTRACT: one `[RANK]`
 * block per candidate, ranked best to worst, then reasoning prose after all
 * of them). Fixed rather than derived from the prompt — unlike the stub in
 * `backend/test/watchlist-ranking.e2e-spec.ts`, which reverses whatever
 * candidates it is handed — because the one browser spec that reaches this
 * always ranks the same two tickers (AAPL, NVDA) in the same order, so there
 * is nothing to reverse-engineer from the prompt text.
 */
const RANKING_STUB_ANSWER = `[RANK]
SYMBOL: AAPL
VERDICT: Stub verdict: AAPL first.
COVERAGE: full
[/RANK]
[RANK]
SYMBOL: NVDA
VERDICT: Stub verdict: NVDA second.
COVERAGE: full
[/RANK]

Stub reasoning: AAPL ranked ahead of NVDA in this fixed browser-test answer.`;

/**
 * The API, for browser tests only.
 *
 * A separate entry point rather than a flag inside `main.ts`, so production
 * carries no branch that swaps a data provider for a fake. Its only
 * differences from the real bootstrap are the stubbed `YahooClient` — which
 * is not optional: every write path creates an instrument from a live quote,
 * so without it the suite would reach the network, assert a different price
 * every day, and fail on a plane — and the stubbed `LlmClient`, for the same
 * reason: the watchlist-ranking spec would otherwise call a real model. That
 * is the rule `test/offline-guard.ts` enforces for the unit and e2e suites;
 * this is the same rule for the browser suite, applied the only way a real
 * server process allows.
 *
 * Excluded from tsconfig.build.json, so it never reaches the deployed image.
 *
 * The `LlmClient` stub answers EVERY call with `RANKING_STUB_ANSWER`, whatever
 * the caller asked for. Harmless for the one browser spec that reaches it
 * today (the watchlist ranking), but the first spec that also drives the AI
 * portfolio summary or the trade-idea opinion through this server will get a
 * `[RANK]` block back instead of prose — widen this stub (e.g. branch on the
 * system prompt) before adding one.
 */
async function bootstrap() {
  await ensureDatabaseReady();

  /**
   * Built through the testing module, which is the ONLY way to substitute a
   * provider in a real server process — `NestFactory.create` has no
   * `overrideProvider`. The first version of this file imported the Yahoo
   * stub and never applied it, so the browser suite quietly hit the live
   * Yahoo API and asserted against whatever NVDA happened to cost that
   * minute. Caught by a spec expecting the stub's $200 and seeing $218.29 —
   * exactly the failure mode an unapplied `LlmClient` override would repeat
   * against a real model instead.
   */
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(YahooClient)
    .useValue(yahooStub({ withBars: true }))
    .overrideProvider(LlmClient)
    .useValue({
      isConfigured: () => true,
      modelName: () => 'stub-ranking-model',
      complete: async () => RANKING_STUB_ANSWER,
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
