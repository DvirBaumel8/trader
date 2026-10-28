import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service.js';
import { AssistantController } from './assistant.controller.js';
import { HoldingsModule } from '../holdings/holdings.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { LlmModule } from '../llm/llm.module.js';

@Module({
  imports: [HoldingsModule, WatchlistModule, InstrumentsModule, LlmModule],
  providers: [AssistantService],
  controllers: [AssistantController],
})
export class AssistantModule {}
