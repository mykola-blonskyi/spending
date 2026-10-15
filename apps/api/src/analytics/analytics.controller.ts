import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { AnalyticsService } from './analytics.service';
import { summaryQuerySchema, summarySchema } from './summary';

class SummaryQueryDto extends createZodDto(summaryQuerySchema) {}
class SummaryDto extends createZodDto(summarySchema) {}

// @ApiQuery is explicit because tsx, which writes the OpenAPI file, emits no parameter metadata.
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @ApiQuery({ type: SummaryQueryDto })
  @ZodResponse({ status: 200, type: SummaryDto })
  summary(@CurrentActor() actor: Actor, @Query() query: SummaryQueryDto) {
    return this.analytics.summary(actor.userId, query);
  }
}
