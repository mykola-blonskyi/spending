import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { type ActorRequest, IS_PUBLIC } from '../common/actor';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { ApiError } from '../common/errors';
import { isCsrfSafe } from './csrf';
import {
  clearSessionCookie,
  readCookie,
  sessionCookieName,
  setSessionCookie,
} from './session-cookie';
import { SessionService, SupersededTokenError } from './session.service';

const header = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

/** Resolves the actor from the session cookie. Never from client-supplied ids (BR-1). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<ActorRequest>();
    const res = http.getResponse<Response>();
    const token = readCookie(req, sessionCookieName(this.config.cookieSecure));
    if (!token) throw new ApiError('AUTH_REQUIRED');
    try {
      const { actor, rotated } = await this.sessions.authenticate(token);
      if (rotated)
        setSessionCookie(res, this.config.cookieSecure, rotated.token, rotated.expiresAt);
      req.actor = actor;
      return true;
    } catch (error) {
      if (error instanceof ApiError && !(error instanceof SupersededTokenError)) {
        clearSessionCookie(res, this.config.cookieSecure);
      }
      throw error;
    }
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ActorRequest>();
    const safe = isCsrfSafe({
      method: req.method,
      appOrigin: this.config.appOrigin,
      sessionCsrfToken: req.actor?.csrfToken,
      headerToken: header(req.headers['x-csrf-token']),
      origin: header(req.headers.origin),
      secFetchSite: header(req.headers['sec-fetch-site']),
    });
    if (!safe) throw new ApiError('CSRF_FAILED');
    return true;
  }
}
