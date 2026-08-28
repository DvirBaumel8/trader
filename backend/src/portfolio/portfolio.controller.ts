import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PortfolioService } from './portfolio.service.js';

class SeedHoldingDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  avgCost: number;
}

class SeedDto {
  @IsISO8601()
  asOf: string;

  @IsNumber()
  startingCash: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SeedHoldingDto)
  holdings: SeedHoldingDto[];
}

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  get() {
    return this.portfolio.getPortfolio();
  }

  @Get('status')
  async status() {
    return { seeded: await this.portfolio.isSeeded() };
  }

  @Post('seed')
  seed(@Body() body: SeedDto) {
    return this.portfolio.seed(body);
  }

  @Delete('reset')
  async reset() {
    await this.portfolio.reset();
    return { ok: true };
  }
}
