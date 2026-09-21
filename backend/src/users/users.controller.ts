import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsISO8601, IsNumber, IsPositive } from 'class-validator';
import { UsersService } from './users.service.js';

class SettingsDto {
  @IsNumber()
  defaultFee: number;
}

class InterestAccrualDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsISO8601()
  asOf: string;
}

@Controller('settings')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get() {
    return this.users.getSettings();
  }

  @Patch()
  update(@Body() body: SettingsDto) {
    return this.users.updateSettings(body.defaultFee);
  }

  @Patch('interest-accrual')
  updateInterestAccrual(@Body() body: InterestAccrualDto) {
    return this.users.updateInterestAccrual(body.amount, body.asOf);
  }
}
