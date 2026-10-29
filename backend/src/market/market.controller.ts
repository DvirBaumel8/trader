import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { MovesService } from './moves.service.js';

const MAX_SYMBOLS = 60;

@Controller('market')
export class MarketController {
  constructor(private readonly moves: MovesService) {}

  @Get('moves')
  getMoves(@Query('symbols') raw?: string) {
    const symbols = [
      ...new Set(
        (typeof raw === 'string' ? raw : '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (symbols.length < 1 || symbols.length > MAX_SYMBOLS) {
      throw new BadRequestException(`symbols must list 1 to ${MAX_SYMBOLS} tickers`);
    }
    return this.moves.moves(symbols);
  }
}
