import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { clearSessionCookie } from '../auth/session-cookie';
import { type Actor, CurrentActor } from '../common/actor';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { RateLimit } from '../common/rate-limit';
import { deleteUserBodySchema } from './data-rights';
import { DataRightsService } from './data-rights.service';
import { dataExportSchema } from './export-sections';

class DataExportDto extends createZodDto(dataExportSchema) {}
class DeleteUserDto extends createZodDto(deleteUserBodySchema) {}

// @ApiBody is explicit because tsx, which writes the OpenAPI file, emits no parameter metadata.
@Controller('v1/me')
@ApiExtraModels(DataExportDto)
export class DataRightsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DataRightsService) private readonly dataRights: DataRightsService,
  ) {}

  /** A file download, so the body bypasses the zod serializer; its JSON shape is DataExportDto. */
  @Get('export')
  @RateLimit('sensitive')
  @ApiOkResponse({
    description: 'Everything the caller can see',
    content: { 'application/json': { schema: { $ref: getSchemaPath(DataExportDto) } } },
  })
  async export(@CurrentActor() actor: Actor) {
    const document = await this.dataRights.exportData(actor.userId);
    return new StreamableFile(Buffer.from(JSON.stringify(document, null, 2), 'utf8'), {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="spending-export-${document.exportedAt.slice(0, 10)}.json"`,
    });
  }

  @Delete()
  @RateLimit('sensitive')
  @HttpCode(204)
  @ApiBody({ type: DeleteUserDto })
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: Actor,
    @Body() body: DeleteUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.dataRights.deleteUser(actor.userId, body.confirmation);
    clearSessionCookie(res, this.config.cookieSecure);
  }
}
