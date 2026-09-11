import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { AppModule } from './app.module.js';
import { ensureDatabaseReady } from './database/startup.js';

async function bootstrap() {
  await ensureDatabaseReady();

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((req: any, _res: any, next: any) => {
    if (req.url === '/api/health' || req.url.startsWith('/api/health?') || req.url.startsWith('/api/health/')) {
      req.url = req.url.replace(/^\/api\/health/, '/health');
    } else if (
      req.url.startsWith('/portfolio') ||
      req.url.startsWith('/performance') ||
      req.url.startsWith('/journal') ||
      req.url.startsWith('/watchlist') ||
      req.url.startsWith('/auth') ||
      req.url.startsWith('/ai') ||
      req.url.startsWith('/settings') ||
      req.url.startsWith('/instruments') ||
      req.url.startsWith('/market-data') ||
      req.url.startsWith('/history')
    ) {
      req.url = '/api' + req.url;
    }
    next();
  });

  // Expose backend API at /api/* to match frontend client expectations
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/ping'],
  });

  if (process.env.WEB_ORIGINS) {
    app.enableCors({
      origin: process.env.WEB_ORIGINS.split(',').map((o) => o.trim()),
    });
  }

  // Serve the frontend SPA build from frontend/dist
  const frontendDist = path.resolve(process.cwd(), 'frontend/dist');
  if (existsSync(frontendDist)) {
    expressApp.use(express.static(frontendDist));
    expressApp.use((req: any, res: any, next: any) => {
      if (req.method !== 'GET') {
        return next();
      }
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
        return next();
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  /**
   * PORT, not a hard-coded 3000.
   *
   * The monorepo restructure replaced `process.env.PORT ?? 3000` with a
   * literal. Render assigns the port it expects a web service to bind, so
   * this only works while that assignment happens to be 3000 — and it makes
   * a second local instance (against a snapshot database, say) impossible,
   * which is how it was noticed.
   */
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`[AI Studio] Trader application running on http://0.0.0.0:${port}`);
}
void bootstrap();
