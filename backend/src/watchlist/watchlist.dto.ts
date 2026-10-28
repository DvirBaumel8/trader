import { IsString, Length } from 'class-validator';

export class AddWatchlistDto {
  @IsString()
  @Length(1, 12)
  symbol: string;
}
