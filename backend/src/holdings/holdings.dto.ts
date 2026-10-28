import { IsIn } from 'class-validator';
import type { Direction } from './holding.entity.js';

export class SetHoldingDto {
  @IsIn(['LONG', 'SHORT'])
  direction: Direction;
}
