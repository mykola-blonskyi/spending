import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { type Actor, CurrentActor } from '../common/actor';
import { transactionQuerySchema } from './history';
import { LedgerService } from './ledger.service';
import {
  accountViewSchema,
  categoryViewSchema,
  createAccountSchema,
  createCategorySchema,
  transactionViewSchema,
  updateAccountSchema,
  updateCategorySchema,
  workspaceFilterSchema,
} from './views';

class AccountDto extends createZodDto(accountViewSchema) {}
class AccountListDto extends createZodDto(z.object({ accounts: z.array(accountViewSchema) })) {}
class CreateAccountDto extends createZodDto(createAccountSchema) {}
class UpdateAccountDto extends createZodDto(updateAccountSchema) {}
class CategoryDto extends createZodDto(categoryViewSchema) {}
class CategoryListDto extends createZodDto(z.object({ categories: z.array(categoryViewSchema) })) {}
class CreateCategoryDto extends createZodDto(createCategorySchema) {}
class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
class WorkspaceFilterDto extends createZodDto(workspaceFilterSchema) {}
class TransactionQueryDto extends createZodDto(transactionQuerySchema) {}
class TransactionPageDto extends createZodDto(
  z.object({
    transactions: z.array(transactionViewSchema),
    nextCursor: z.string().nullable().meta({ id: 'NextCursor' }),
  }),
) {}

// @ApiBody and @ApiQuery are explicit because tsx, which writes the OpenAPI file, emits no
// parameter metadata.
@Controller('v1')
export class LedgerController {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}

  @Get('accounts')
  @ApiQuery({ type: WorkspaceFilterDto })
  @ZodResponse({ status: 200, type: AccountListDto })
  async accounts(@CurrentActor() actor: Actor, @Query() query: WorkspaceFilterDto) {
    return { accounts: await this.ledger.listAccounts(actor.userId, query.workspaceId) };
  }

  @Post('accounts')
  @ApiBody({ type: CreateAccountDto })
  @ZodResponse({ status: 201, type: AccountDto })
  createAccount(@CurrentActor() actor: Actor, @Body() body: CreateAccountDto) {
    return this.ledger.createAccount(actor.userId, body);
  }

  @Patch('accounts/:id')
  @ApiBody({ type: UpdateAccountDto })
  @ZodResponse({ status: 200, type: AccountDto })
  updateAccount(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAccountDto,
  ) {
    return this.ledger.updateAccount(actor.userId, id, body);
  }

  @Get('categories')
  @ApiQuery({ type: WorkspaceFilterDto })
  @ZodResponse({ status: 200, type: CategoryListDto })
  async categories(@CurrentActor() actor: Actor, @Query() query: WorkspaceFilterDto) {
    return { categories: await this.ledger.listCategories(actor.userId, query.workspaceId) };
  }

  @Post('categories')
  @ApiBody({ type: CreateCategoryDto })
  @ZodResponse({ status: 201, type: CategoryDto })
  createCategory(@CurrentActor() actor: Actor, @Body() body: CreateCategoryDto) {
    return this.ledger.createCategory(actor.userId, body);
  }

  @Patch('categories/:id')
  @ApiBody({ type: UpdateCategoryDto })
  @ZodResponse({ status: 200, type: CategoryDto })
  updateCategory(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCategoryDto,
  ) {
    return this.ledger.updateCategory(actor.userId, id, body);
  }

  @Get('transactions')
  @ApiQuery({ type: TransactionQueryDto })
  @ZodResponse({ status: 200, type: TransactionPageDto })
  transactions(@CurrentActor() actor: Actor, @Query() query: TransactionQueryDto) {
    return this.ledger.listTransactions(actor.userId, query);
  }
}
