import { IsArray, IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import type { Edge, NodeInput } from './graph.js';

/** Shape only. What the nodes and edges may contain is `validateGraph`'s job. */
class BaseWriteDto {
  @IsInt()
  @Min(0)
  baseVersion: number;

  @IsString()
  @Length(1, 120)
  message: string;
}

export class PutGraphDto extends BaseWriteDto {
  @IsArray()
  @IsObject({ each: true })
  nodes: NodeInput[];

  @IsArray()
  @IsObject({ each: true })
  edges: Edge[];
}

export class RevertDto extends BaseWriteDto {
  @IsInt()
  @Min(1)
  version: number;
}

export class DeleteGraphDto extends BaseWriteDto {}
