import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { AppModule } from './app.module.js';
import { initDatabaseIfOffline } from './database/in-memory-db.js';

async function bootstrap() {
  await initDatabaseIfOffline();

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

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
  const expressApp = app.getHttpAdapter().getInstance();
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

  const port = 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`[AI Studio] Trader application running on http://0.0.0.0:${port}`);
}
void bootstrap();
