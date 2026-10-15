import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { BudgetsService } from './budgets.service';
import { budgetListSchema, budgetQuerySchema, budgetViewSchema, putBudgetSchema } from './progress';

class BudgetQueryDto extends createZodDto(budgetQuerySchema) {}
class BudgetListDto extends createZodDto(budgetListSchema) {}
class BudgetDto extends createZodDto(budgetViewSchema) {}
class PutBudgetDto extends createZodDto(putBudgetSchema) {}

// @ApiBody, @ApiParam and @ApiQuery are explicit because tsx, which writes the OpenAPI file, emits no
// parameter metadata.
@Controller('v1/budgets')
export class BudgetsController {
  constructor(@Inject(BudgetsService) private readonly budgets: BudgetsService) {}

  @Get()
  @ApiQuery({ type: BudgetQueryDto })
  @ZodResponse({ status: 200, type: BudgetListDto })
  async list(@CurrentActor() actor: Actor, @Query() query: BudgetQueryDto) {
    return { budgets: await this.budgets.list(actor.userId, query) };
  }

  @Put()
  @ApiBody({ type: PutBudgetDto })
  @ZodResponse({ status: 200, type: BudgetDto })
  put(@CurrentActor() actor: Actor, @Body() body: PutBudgetDto) {
    return this.budgets.put(actor.userId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.remove(actor.userId, id);
  }
}
