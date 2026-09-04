import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * The largest magnitude a `numeric(20,8)` column accepts. Past this Postgres
 * raises rather than storing, and an unvalidated request became a 500 that
 * quoted the database at the caller.
 */
const MAX_NUMERIC = 1e11;

export class StopExecutionDto {
  @IsUUID()
  stopLevelId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}

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

  /**
   * Signed: positive buys, negative sells. Bounded because the column is
   * `numeric(20,8)` — anything at or past 10^12 makes Postgres raise
   * "must round to an absolute value less than 10^12", which surfaced as a
   * 500 with the database's own error text in it. A rejected request should
   * say what is wrong with it, not leak the schema.
   */
  @IsNumber()
  @Min(-MAX_NUMERIC)
  @Max(MAX_NUMERIC)
  quantity: number;

  /**
   * Strictly positive. A negative price is not a short — direction lives in
   * the sign of `quantity` — it is nonsense that silently corrupts cost
   * basis, cash and every figure derived from them. The API used to accept
   * it and return 201.
   */
  @IsNumber()
  @IsPositive()
  @Max(MAX_NUMERIC)
  price: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_NUMERIC)
  fee?: number;

  /** The plan at entry. Optional — see the decisions table. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_NUMERIC)
  plannedTarget?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StopLevelDto)
  stopLevels?: StopLevelDto[];

  /** The owner's confirmation of which stop tier a reducing fill executed. */
  @IsOptional()
  @IsIn(['STOP', 'DISCRETIONARY'])
  exitKind?: 'STOP' | 'DISCRETIONARY';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StopExecutionDto)
  stopExecutions?: StopExecutionDto[];
}

export class CashDto {
  @IsIn(['DEPOSIT', 'WITHDRAW'])
  direction: 'DEPOSIT' | 'WITHDRAW';

  @IsNumber()
  amount: number;
}

export class DividendDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  /** Always positive: cash received, after any withholding. */
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
  @IsIn(['TRADE', 'NOTE', 'CASH', 'DIVIDEND'])
  kind: 'TRADE' | 'NOTE' | 'CASH' | 'DIVIDEND';

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
  @ValidateNested()
  @Type(() => DividendDto)
  dividend?: DividendDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagDto)
  tags?: TagDto[];
}
