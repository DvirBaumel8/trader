import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { JournalService, type CreateEntryInput } from './journal.service.js';
import { CreateEntryDto } from './journal.dto.js';

/** One mapping from wire shape to service input, used by create and update. */
function toInput(body: CreateEntryDto): CreateEntryInput {
  return {
    kind: body.kind,
    body: body.body ?? '',
    occurredAt: body.occurredAt,
    trade: body.trade
      ? {
          symbol: body.trade.symbol,
          quantity: body.trade.quantity,
          price: body.trade.price,
          fee: body.trade.fee ?? 0,
          plannedTarget: body.trade.plannedTarget ?? null,
          stopLevels: body.trade.stopLevels,
          exitKind: body.trade.exitKind ?? null,
          stopExecutions: body.trade.stopExecutions,
        }
      : undefined,
    cash: body.cash,
    dividend: body.dividend,
    tags: body.tags,
  };
}

@Controller('journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  // Declared before ':id' routes so "tags" is never matched as an id.
  @Get('tags')
  tags() {
    return this.journal.listTags();
  }

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('kind') kind?: 'TRADE' | 'NOTE' | 'CASH' | 'DIVIDEND',
    @Query('tagId') tagId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.journal.list({ symbol, kind, tagId, search, from, to });
  }

  @Post()
  create(@Body() body: CreateEntryDto) {
    return this.journal.create(toInput(body));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateEntryDto) {
    return this.journal.update(id, toInput(body));
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.journal.remove(id);
    return { ok: true };
  }
}
