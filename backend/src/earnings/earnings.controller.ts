import { Controller, Get } from '@nestjs/common';
import { EarningsService } from './earnings.service.js';

@Controller('earnings')
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('week')
  week() {
    return this.earnings.week();
  }
}
