import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { UsersModule } from '../users/users.module.js';
import { KnowledgeGraph } from './knowledge-graph.entity.js';
import { KnowledgeVersion } from './knowledge-version.entity.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeGraph, KnowledgeVersion]), InstrumentsModule, UsersModule],
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
})
export class KnowledgeModule {}
