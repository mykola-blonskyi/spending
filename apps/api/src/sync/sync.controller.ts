import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { RateLimit } from '../common/rate-limit';
import {
  conflictListSchema,
  pullQuerySchema,
  pullResponseSchema,
  pushBodySchema,
  pushResponseSchema,
  resolveBodySchema,
  resolveResponseSchema,
} from './mutations';
import { SyncService } from './sync.service';

class PushDto extends createZodDto(pushBodySchema) {}
class PushResponseDto extends createZodDto(pushResponseSchema) {}
class PullQueryDto extends createZodDto(pullQuerySchema) {}
class PullResponseDto extends createZodDto(pullResponseSchema) {}
class ConflictListDto extends createZodDto(conflictListSchema) {}
class ResolveDto extends createZodDto(resolveBodySchema) {}
class ResolveResponseDto extends createZodDto(resolveResponseSchema) {}

/** The single write path for transactions (ADR-006). Protocol: docs/architecture.md. */
@Controller('v1/sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  @RateLimit('sync')
  @ApiBody({ type: PushDto })
  @ZodResponse({ status: 200, type: PushResponseDto })
  async push(
    @CurrentActor() actor: Actor,
    @Body() body: PushDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const gone = new AbortController();
    res.on('close', () => gone.abort());
    return { results: await this.sync.push(actor.userId, body.mutations, gone.signal) };
  }

  @Get('pull')
  @ApiQuery({ type: PullQueryDto })
  @ZodResponse({ status: 200, type: PullResponseDto })
  pull(@CurrentActor() actor: Actor, @Query() query: PullQueryDto) {
    return this.sync.pull(actor.userId, query.cursor, query.limit);
  }

  @Get('conflicts')
  @ZodResponse({ status: 200, type: ConflictListDto })
  async conflicts(@CurrentActor() actor: Actor) {
    return { conflicts: await this.sync.conflicts(actor.userId) };
  }

  @Post('conflicts/:id/resolve')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ResolveDto })
  @ZodResponse({ status: 200, type: ResolveResponseDto })
  resolve(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResolveDto,
  ) {
    return this.sync.resolve(actor.userId, id, body.resolution, body.transaction);
  }
}
