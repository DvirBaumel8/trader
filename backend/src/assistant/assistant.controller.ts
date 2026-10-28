import { Body, Controller, Post } from '@nestjs/common';
import { AssistantService } from './assistant.service.js';
import { AssistantDto } from './assistant.dto.js';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  handle(@Body() body: AssistantDto) {
    return this.assistant.handle(body.text);
  }
}
