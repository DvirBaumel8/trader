import { IsString, Length } from 'class-validator';

export class AssistantDto {
  @IsString()
  @Length(1, 2000)
  text: string;
}
