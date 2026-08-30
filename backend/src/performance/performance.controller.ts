import { Controller, Get, Query } from '@nestjs/common';
import { PerformanceService, type Range } from './performance.service.js';

const RANGES: Range[] = ['1M', '6M', 'YTD', '1Y', 'ALL'];

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  get(@Query('range') range?: string) {
    const valid = RANGES.includes(range as Range) ? (range as Range) : 'ALL';
    return this.performance.getSeries(valid);
  }
}
