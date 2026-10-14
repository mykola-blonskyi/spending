import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { RateLimit } from '../common/rate-limit';
import { ImportsService } from './imports.service';
import { importBodySchema, importResultSchema } from './schemas';

class ImportDto extends createZodDto(importBodySchema) {}
class ImportResultDto extends createZodDto(importResultSchema) {}

// @ApiBody is explicit because tsx, which writes the OpenAPI file, emits no parameter metadata.
@Controller('v1/imports')
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly imports: ImportsService) {}

  @Post()
  @RateLimit('sensitive')
  @ApiBody({ type: ImportDto })
  @ZodResponse({ status: 201, type: ImportResultDto })
  create(@CurrentActor() actor: Actor, @Body() body: ImportDto) {
    return this.imports.create(actor.userId, body);
  }
}
