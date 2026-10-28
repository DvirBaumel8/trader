import { Module } from '@nestjs/common';
import { GeminiClient, LlmClient } from './llm.client.js';

@Module({
  providers: [{ provide: LlmClient, useClass: GeminiClient }],
  exports: [LlmClient],
})
export class LlmModule {}
