import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service.js';

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
}
