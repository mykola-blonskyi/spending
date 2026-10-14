import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../common/actor';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { DB, type Db } from '../database/database.module';

class HealthDto extends createZodDto(z.object({ status: z.literal('ok'), version: z.string() })) {}

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @ZodResponse({ status: 200, type: HealthDto })
  live() {
    return { status: 'ok' as const, version: this.config.version };
  }

  @Get('ready')
  @ZodResponse({ status: 200, type: HealthDto })
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' as const, version: this.config.version };
  }
}
