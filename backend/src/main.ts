import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // 0.0.0.0 so the phone on the same Wi-Fi can reach it.
  await app.listen(3000, '0.0.0.0');
}
void bootstrap();
