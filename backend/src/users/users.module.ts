import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { ApiKey } from './api-key.entity.js';
import { UsersService } from './users.service.js';
import { ApiKeysService } from './api-keys.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, ApiKey])],
  providers: [UsersService, ApiKeysService],
  exports: [UsersService, ApiKeysService],
})
export class UsersModule {}
