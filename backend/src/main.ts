import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Unset locally: the frontend and backend are the same origin there
  // (Vite's dev proxy), so no CORS handling is needed. In production the
  // frontend is on Cloudflare Pages, a different origin — see render.yaml.
  if (process.env.WEB_ORIGINS) {
    app.enableCors({
      origin: process.env.WEB_ORIGINS.split(',').map((o) => o.trim()),
    });
  }
  // 0.0.0.0 so the phone on the same Wi-Fi can reach it. Render injects
  // PORT and expects the service to bind it; 3000 is only the local default.
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
