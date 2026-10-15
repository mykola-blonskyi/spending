import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { clearSessionCookie } from '../auth/session-cookie';
import { type Actor, CurrentActor } from '../common/actor';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { RateLimit } from '../common/rate-limit';
import { deleteUserBodySchema, exportQuerySchema } from './data-rights';
import { DataRightsService } from './data-rights.service';
import { dataExportSchema } from './export-sections';

class DataExportDto extends createZodDto(dataExportSchema) {}
class ExportQueryDto extends createZodDto(exportQuerySchema) {}
class DeleteUserDto extends createZodDto(deleteUserBodySchema) {}

// @ApiBody and @ApiQuery are explicit because tsx, which writes the OpenAPI file, emits no
// parameter metadata.
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
  @ApiQuery({ type: ExportQueryDto })
  @ApiOkResponse({
    description: 'Everything the caller can see (JSON) or their confirmed transactions (CSV)',
    content: {
      'application/json': { schema: { $ref: getSchemaPath(DataExportDto) } },
      'text/csv': { schema: { type: 'string' } },
    },
  })
  async export(@CurrentActor() actor: Actor, @Query() query: ExportQueryDto) {
    const file = await this.dataRights.exportFile(actor.userId, query.format);
    return new StreamableFile(Buffer.from(file.body, 'utf8'), {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
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
