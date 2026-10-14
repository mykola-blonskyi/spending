import { Controller, Get } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';

class HealthDto extends createZodDto(z.object({ status: z.literal('ok') })) {}

@Controller('health')
export class HealthController {
  @Get()
  @ZodResponse({ status: 200, type: HealthDto })
  live() {
    return { status: 'ok' as const };
  }
}
