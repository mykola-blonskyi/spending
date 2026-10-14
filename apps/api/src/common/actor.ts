import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** The authenticated caller. Built by the session guard from the cookie only (BR-1). */
export type Actor = Readonly<{
  userId: string;
  sessionTokenHash: string;
  csrfToken: string;
}>;

export type ActorRequest = Request & { actor?: Actor };

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/** Opts a route out of the session requirement. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const actor = ctx.switchToHttp().getRequest<ActorRequest>().actor;
  if (!actor) throw new Error('CurrentActor used on a route without a session');
  return actor;
});
