import { Controller, Post } from '@nestjs/common';
import { HistoryService } from './history.service.js';

@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Post('backfill')
  backfill() {
    return this.history.backfill();
  }
}
