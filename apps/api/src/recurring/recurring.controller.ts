import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { RateLimit } from '../common/rate-limit';
import { workspaceFilterSchema } from '../ledger/views';
import { RecurringService } from './recurring.service';
import { createRuleSchema, ruleListSchema, ruleViewSchema, updateRuleSchema } from './rules';

class WorkspaceFilterDto extends createZodDto(workspaceFilterSchema) {}
class RuleListDto extends createZodDto(ruleListSchema) {}
class RuleDto extends createZodDto(ruleViewSchema) {}
class CreateRuleDto extends createZodDto(createRuleSchema) {}
class UpdateRuleDto extends createZodDto(updateRuleSchema) {}

// @ApiBody, @ApiParam and @ApiQuery are explicit because tsx, which writes the OpenAPI file, emits no
// parameter metadata. Writes are rate limited because one can generate many transactions.
@Controller('v1/recurring-rules')
export class RecurringController {
  constructor(@Inject(RecurringService) private readonly recurring: RecurringService) {}

  @Get()
  @ApiQuery({ type: WorkspaceFilterDto })
  @ZodResponse({ status: 200, type: RuleListDto })
  async list(@CurrentActor() actor: Actor, @Query() query: WorkspaceFilterDto) {
    return { rules: await this.recurring.list(actor.userId, query.workspaceId) };
  }

  @Post()
  @RateLimit('sensitive')
  @ApiBody({ type: CreateRuleDto })
  @ZodResponse({ status: 201, type: RuleDto })
  create(@CurrentActor() actor: Actor, @Body() body: CreateRuleDto) {
    return this.recurring.create(actor.userId, body);
  }

  @Patch(':id')
  @RateLimit('sensitive')
  @ApiBody({ type: UpdateRuleDto })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ZodResponse({ status: 200, type: RuleDto })
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRuleDto,
  ) {
    return this.recurring.update(actor.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.remove(actor.userId, id);
  }
}
