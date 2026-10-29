import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { AllowApiKey } from '../auth/allow-api-key.decorator.js';
import { DeleteGraphDto, PutGraphDto, RevertDto } from './dto.js';
import { FundamentalsService } from './fundamentals.service.js';
import { KnowledgeService } from './knowledge.service.js';

@AllowApiKey()
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly fundamentals: FundamentalsService,
  ) {}

  @Get()
  list() {
    return this.knowledge.list();
  }

  @Get(':symbol')
  get(@Param('symbol') symbol: string) {
    return this.knowledge.get(symbol);
  }

  @Get(':symbol/fundamentals')
  fundamentalsFor(@Param('symbol') symbol: string) {
    return this.fundamentals.get(symbol, new Date());
  }

  @Post(':symbol/viewed')
  viewed(@Param('symbol') symbol: string) {
    return this.knowledge.markViewed(symbol);
  }

  @Get(':symbol/versions')
  versions(@Param('symbol') symbol: string) {
    return this.knowledge.versions(symbol);
  }

  @Post(':symbol/revert')
  revert(@Param('symbol') symbol: string, @Body() body: RevertDto) {
    return this.knowledge.revert(symbol, body.baseVersion, body.version, body.message);
  }

  @Put(':symbol')
  put(@Param('symbol') symbol: string, @Body() body: PutGraphDto) {
    return this.knowledge.put(symbol, body.baseVersion, body.message, { nodes: body.nodes, edges: body.edges });
  }

  @Delete(':symbol')
  remove(@Param('symbol') symbol: string, @Body() body: DeleteGraphDto) {
    return this.knowledge.remove(symbol, body.baseVersion, body.message);
  }
}
