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

/**
 * The API, for browser tests only.
 *
 * A separate entry point rather than a flag inside `main.ts`, so production
 * carries no branch that swaps a data provider for a fake. The only
 * difference from the real bootstrap is the stubbed YahooClient — which is
 * not optional: every write path creates an instrument from a live quote, so
 * without it the suite would reach the network, assert a different price
 * every day, and fail on a plane. That is the rule `test/offline-guard.ts`
 * enforces for the unit and e2e suites; this is the same rule for the browser
 * suite, applied the only way a real server process allows.
 *
 * Excluded from tsconfig.build.json, so it never reaches the deployed image.
 */
async function bootstrap() {
  await ensureDatabaseReady();

  /**
   * Built through the testing module, which is the ONLY way to substitute a
   * provider in a real server process — `NestFactory.create` has no
   * `overrideProvider`. The first version of this file imported the stub and
   * never applied it, so the browser suite quietly hit the live Yahoo API and
   * asserted against whatever NVDA happened to cost that minute. Caught by a
   * spec expecting the stub's $200 and seeing $218.29.
   */
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(YahooClient)
    .useValue(yahooStub({ withBars: true }))
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
