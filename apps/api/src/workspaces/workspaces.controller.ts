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
} from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiParam } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { RateLimit } from '../common/rate-limit';
import {
  createdInvitationSchema,
  createInvitationBodySchema,
  deleteFamilyBodySchema,
  eventListSchema,
  familyNameBodySchema,
  invitationListSchema,
  invitationPreviewSchema,
  transferBodySchema,
  workspaceListSchema,
  workspaceViewSchema,
} from './family';
import { FamilyService } from './family.service';

class WorkspaceListDto extends createZodDto(workspaceListSchema) {}
class WorkspaceDto extends createZodDto(workspaceViewSchema) {}
class FamilyNameDto extends createZodDto(familyNameBodySchema) {}
class DeleteFamilyDto extends createZodDto(deleteFamilyBodySchema) {}
class CreateInvitationDto extends createZodDto(createInvitationBodySchema) {}
class CreatedInvitationDto extends createZodDto(createdInvitationSchema) {}
class InvitationListDto extends createZodDto(invitationListSchema) {}
class InvitationPreviewDto extends createZodDto(invitationPreviewSchema) {}
class TransferDto extends createZodDto(transferBodySchema) {}
class EventListDto extends createZodDto(eventListSchema) {}

// @ApiBody and @ApiParam are explicit because tsx, which writes the OpenAPI file, emits no
// parameter metadata.
@Controller('v1')
export class WorkspacesController {
  constructor(@Inject(FamilyService) private readonly family: FamilyService) {}

  @Get('workspaces')
  @ZodResponse({ status: 200, type: WorkspaceListDto })
  async list(@CurrentActor() actor: Actor) {
    return { workspaces: await this.family.workspaces(actor.userId) };
  }

  @Post('family')
  @ApiBody({ type: FamilyNameDto })
  @ZodResponse({ status: 201, type: WorkspaceDto })
  create(@CurrentActor() actor: Actor, @Body() body: FamilyNameDto) {
    return this.family.create(actor.userId, body.name);
  }

  @Patch('family')
  @ApiBody({ type: FamilyNameDto })
  @ZodResponse({ status: 200, type: WorkspaceDto })
  rename(@CurrentActor() actor: Actor, @Body() body: FamilyNameDto) {
    return this.family.rename(actor.userId, body.name);
  }

  @Delete('family')
  @HttpCode(204)
  @ApiBody({ type: DeleteFamilyDto })
  @ApiNoContentResponse()
  remove(@CurrentActor() actor: Actor, @Body() body: DeleteFamilyDto) {
    return this.family.delete(actor.userId, body.confirmName);
  }

  @Post('family/invitations')
  @RateLimit('sensitive')
  @ApiBody({ type: CreateInvitationDto })
  @ZodResponse({ status: 201, type: CreatedInvitationDto })
  invite(@CurrentActor() actor: Actor, @Body() body: CreateInvitationDto) {
    return this.family.createInvitation(actor.userId, body.expiresInDays);
  }

  @Get('family/invitations')
  @ZodResponse({ status: 200, type: InvitationListDto })
  async invitations(@CurrentActor() actor: Actor) {
    return { invitations: await this.family.listInvitations(actor.userId) };
  }

  @Delete('family/invitations/:id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.family.revokeInvitation(actor.userId, id);
  }

  @Post('family/leave')
  @HttpCode(204)
  @ApiNoContentResponse()
  leave(@CurrentActor() actor: Actor) {
    return this.family.leave(actor.userId);
  }

  @Delete('family/members/:userId')
  @HttpCode(204)
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiNoContentResponse()
  removeMember(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.family.removeMember(actor.userId, userId);
  }

  @Post('family/transfer')
  @HttpCode(200)
  @ApiBody({ type: TransferDto })
  @ZodResponse({ status: 200, type: WorkspaceDto })
  transfer(@CurrentActor() actor: Actor, @Body() body: TransferDto) {
    return this.family.transfer(actor.userId, body.userId);
  }

  @Get('family/events')
  @ZodResponse({ status: 200, type: EventListDto })
  async events(@CurrentActor() actor: Actor) {
    return { events: await this.family.events(actor.userId) };
  }

  @Get('invitations/:token')
  @RateLimit('sensitive')
  @ApiParam({ name: 'token' })
  @ZodResponse({ status: 200, type: InvitationPreviewDto })
  preview(@Param('token') token: string) {
    return this.family.previewInvitation(token);
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  @RateLimit('sensitive')
  @ApiParam({ name: 'token' })
  @ZodResponse({ status: 200, type: WorkspaceDto })
  accept(@CurrentActor() actor: Actor, @Param('token') token: string) {
    return this.family.acceptInvitation(actor.userId, token);
  }
}
