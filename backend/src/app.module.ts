import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestLoggingMiddleware } from './common/request-logging.middleware.js';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { InstrumentsModule } from './instruments/instruments.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { JournalModule } from './journal/journal.module.js';
import { PerformanceModule } from './performance/performance.module.js';
import { LlmModule } from './llm/llm.module.js';
import { buildConnectionOptions } from './database/connection-options.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        ...buildConnectionOptions(
          process.env,
          process.env.NODE_ENV === 'test' ? 'trader_test' : undefined,
        ),
        autoLoadEntities: true,
        // Schema now comes from src/database/migrations — see
        // docs/superpowers/specs/2026-09-01-deployment-design.md for why
        // synchronize is unsafe against a persistent shared database.
        synchronize: false,
      }),
    }),
    UsersModule,
    InstrumentsModule,
    JournalModule,
    PortfolioModule,
    PerformanceModule,
    LlmModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule implements NestModule {
  /**
   * Applied to every route. A slow request is worth seeing whichever endpoint
   * it hit — see RequestLoggingMiddleware.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*splat');
  }
}
