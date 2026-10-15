import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { RateLimit } from '../common/rate-limit';
import { ImportsService } from './imports.service';
import { batchListSchema, importBodySchema, importResultSchema, undoResultSchema } from './schemas';

class ImportDto extends createZodDto(importBodySchema) {}
class ImportResultDto extends createZodDto(importResultSchema) {}
class BatchListDto extends createZodDto(batchListSchema) {}
class UndoResultDto extends createZodDto(undoResultSchema) {}

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

  @Get()
  @ZodResponse({ status: 200, type: BatchListDto })
  async list(@CurrentActor() actor: Actor) {
    return { batches: await this.imports.list(actor.userId) };
  }

  @Post(':id/undo')
  @HttpCode(200)
  @RateLimit('sensitive')
  @ZodResponse({ status: 200, type: UndoResultDto })
  undo(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.undo(actor.userId, id);
  }
}
