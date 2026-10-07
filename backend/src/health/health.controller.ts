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

  @Public()
  @Get()
  async check() {
    let database = 'error';
    let userId: string | null = null;
    try {
      await this.dataSource.query('SELECT 1');
      database = 'ok';
      userId = (await this.users.currentUser()).id;
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
    // Render sets RENDER_GIT_COMMIT to the deployed SHA, so the live backend
    // version can be read off this endpoint. Null outside Render.
    const commit = process.env.RENDER_GIT_COMMIT;
    return { status: 'ok', version: commit ? commit.slice(0, 7) : null };
  }
}
