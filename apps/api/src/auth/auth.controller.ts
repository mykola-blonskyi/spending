import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { type Actor, CurrentActor, Public } from '../common/actor';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { RateLimit } from '../common/rate-limit';
import { profileSchema } from '../users/profile';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  clearSessionCookie,
  readCookie,
  sessionCookieName,
  setSessionCookie,
} from './session-cookie';

class SessionDto extends createZodDto(z.object({ user: profileSchema, csrfToken: z.string() })) {}
class LogoutDto extends createZodDto(
  // Named for the same nestjs-zod nullable quirk as AvatarUrl.
  z.object({ endSessionUrl: z.string().nullable().meta({ id: 'EndSessionUrl' }) }),
) {}

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  @Public()
  @RateLimit('auth')
  @Get('login')
  @ApiQuery({ name: 'returnTo', required: false, type: String })
  @ApiResponse({ status: 302, description: 'Redirect to the identity provider' })
  async login(@Query('returnTo') returnTo: unknown, @Res() res: Response): Promise<void> {
    res.redirect(302, await this.auth.startLogin(returnTo));
  }

  @Public()
  @RateLimit('auth')
  @Get('callback')
  @ApiResponse({ status: 302, description: 'Redirect into the app or back to sign-in' })
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const callbackUrl = new URL(this.config.oidc.redirectUri);
    callbackUrl.search = new URL(req.originalUrl, 'http://callback.invalid').search;
    const previous = readCookie(req, sessionCookieName(this.config.cookieSecure));
    const result = await this.auth.completeLogin(callbackUrl, previous);
    if (!result.ok) {
      res.redirect(302, `/signin?error=${result.error}`);
      return;
    }
    setSessionCookie(res, this.config.cookieSecure, result.session.token, result.session.expiresAt);
    res.redirect(302, result.returnTo);
  }

  @Get('session')
  @ZodResponse({ status: 200, type: SessionDto })
  async session(@CurrentActor() actor: Actor) {
    return { user: await this.users.profile(actor.userId), csrfToken: actor.csrfToken };
  }

  @Post('logout')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: LogoutDto })
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    const endSessionUrl = await this.auth.logout(actor.sessionTokenHash);
    clearSessionCookie(res, this.config.cookieSecure);
    return { endSessionUrl };
  }
}
