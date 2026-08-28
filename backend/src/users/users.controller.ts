import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsNumber } from 'class-validator';
import { UsersService } from './users.service.js';

class SettingsDto {
  @IsNumber()
  defaultFee: number;
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
}
