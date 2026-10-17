import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Actor, CurrentActor } from '../common/actor';
import { profilePatchSchema, profileSchema } from './profile';
import { UsersService } from './users.service';

class ProfileDto extends createZodDto(profileSchema) {}
class UpdateProfileDto extends createZodDto(profilePatchSchema) {}

@Controller('v1/me')
export class MeController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @ZodResponse({ status: 200, type: ProfileDto })
  get(@CurrentActor() actor: Actor) {
    return this.users.profile(actor.userId);
  }

  @Patch()
  // Explicit because tsx, which writes the OpenAPI file, emits no parameter type metadata.
  @ApiBody({ type: UpdateProfileDto })
  @ZodResponse({ status: 200, type: ProfileDto })
  update(@CurrentActor() actor: Actor, @Body() body: UpdateProfileDto) {
    return this.users.updateProfile(actor.userId, body);
  }
}
