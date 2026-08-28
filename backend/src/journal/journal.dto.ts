import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class StopLevelDto {
  @IsIn(['FIXED', 'TRAILING'])
  kind: 'FIXED' | 'TRAILING';

  /** Required for FIXED, ignored for TRAILING. */
  @IsOptional()
  @IsNumber()
  price?: number;

  /** Required for TRAILING, ignored for FIXED. Percent, e.g. 8 means 8%. */
  @IsOptional()
  @IsNumber()
  trailPercent?: number;

  @IsNumber()
  quantity: number;
}

export class TradeDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  /** Signed: positive buys, negative sells. */
  @IsNumber()
  quantity: number;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsNumber()
  fee?: number;

  /** The plan at entry. Optional — see the decisions table. */
  @IsOptional()
  @IsNumber()
  plannedTarget?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StopLevelDto)
  stopLevels?: StopLevelDto[];
}

export class CashDto {
  @IsIn(['DEPOSIT', 'WITHDRAW'])
  direction: 'DEPOSIT' | 'WITHDRAW';

  @IsNumber()
  amount: number;
}

export class TagDto {
  @IsIn(['SETUP', 'MISTAKE'])
  type: 'SETUP' | 'MISTAKE';

  @IsString()
  @Length(1, 40)
  label: string;
}

export class CreateEntryDto {
  @IsIn(['TRADE', 'NOTE', 'CASH'])
  kind: 'TRADE' | 'NOTE' | 'CASH';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @IsISO8601()
  occurredAt: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TradeDto)
  trade?: TradeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CashDto)
  cash?: CashDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagDto)
  tags?: TagDto[];
}
