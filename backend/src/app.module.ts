import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD') || undefined,
        database:
          process.env.NODE_ENV === 'test'
            ? 'trader_test'
            : config.get<string>('DB_NAME', 'trader'),
        autoLoadEntities: true,
        // Single user, local database, no production data.
        synchronize: true,
      }),
    }),
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
