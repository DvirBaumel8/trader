import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpsertWatchlistDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  /**
   * Optional, and explicitly nullable: omitted means "leave the target
   * alone", null means "remove it". The same distinction journal reasons had
   * to learn — sending a default for an absent field is how an edit silently
   * erases something.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetPrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class WatchlistQueryDto {
  @IsOptional()
  @IsIn(['ALL'])
  scope?: 'ALL';
}
