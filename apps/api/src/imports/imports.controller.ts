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
import { ApiBody, ApiNoContentResponse, ApiParam } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { RateLimit } from '../common/rate-limit';
import { ImportsService } from './imports.service';
import {
  batchListSchema,
  confirmBodySchema,
  confirmResultSchema,
  importBodySchema,
  importResultSchema,
  learnBodySchema,
  reviewListSchema,
  undoResultSchema,
} from './schemas';

class ImportDto extends createZodDto(importBodySchema) {}
class ImportResultDto extends createZodDto(importResultSchema) {}
class BatchListDto extends createZodDto(batchListSchema) {}
class UndoResultDto extends createZodDto(undoResultSchema) {}
class ReviewListDto extends createZodDto(reviewListSchema) {}
class ConfirmDto extends createZodDto(confirmBodySchema) {}
class ConfirmResultDto extends createZodDto(confirmResultSchema) {}
class LearnDto extends createZodDto(learnBodySchema) {}

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

  @Get('review')
  @ZodResponse({ status: 200, type: ReviewListDto })
  async review(@CurrentActor() actor: Actor) {
    return { items: await this.imports.review(actor.userId) };
  }

  @Post('review/confirm')
  @HttpCode(200)
  @ApiBody({ type: ConfirmDto })
  @ZodResponse({ status: 200, type: ConfirmResultDto })
  async confirm(@CurrentActor() actor: Actor, @Body() body: ConfirmDto) {
    return { transactions: await this.imports.confirm(actor.userId, body.items) };
  }

  @Post('learn')
  @HttpCode(204)
  @ApiBody({ type: LearnDto })
  @ApiNoContentResponse()
  async learn(@CurrentActor() actor: Actor, @Body() body: LearnDto): Promise<void> {
    await this.imports.learn(actor.userId, body.items);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @RateLimit('sensitive')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ZodResponse({ status: 200, type: UndoResultDto })
  undo(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.undo(actor.userId, id);
  }
}
