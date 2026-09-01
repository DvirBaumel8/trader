import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service.js';
import { Public } from '../auth/public.decorator.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  @Get()
  async check() {
    let database = 'error';
    let userId: string | null = null;
    try {
      await this.dataSource.query('SELECT 1');
      database = 'ok';
      userId = (await this.users.ensureDefaultUser()).id;
    } catch {
      database = 'error';
    }
    return { status: database === 'ok' ? 'ok' : 'degraded', database, userId };
  }

  // Deliberately DB-free — this is what the external keep-warm pinger hits
  // every 5 minutes (see docs/DEPLOYMENT.md). Touching the database here
  // would keep re-waking Neon continuously and risk its free CU-hour cap.
  @Public()
  @Get('ping')
  ping() {
    return { status: 'ok' };
  }
}
