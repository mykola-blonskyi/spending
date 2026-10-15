import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ActorRequest } from './actor';

const MINUTE = 60_000;
const RATE_LIMIT_TAG = Symbol('RATE_LIMIT_TAG');

/** Named budgets a route opts into on top of the global default. */
export type RateLimitName = 'auth' | 'sensitive' | 'sync';

export const RateLimit = (name: RateLimitName) => SetMetadata(RATE_LIMIT_TAG, name);

const reflector = new Reflector();
const notTagged = (name: RateLimitName) => (context: ExecutionContext) =>
  reflector.getAllAndOverride<RateLimitName>(RATE_LIMIT_TAG, [
    context.getHandler(),
    context.getClass(),
  ]) !== name;

/**
 * Budgets are shared across routes per tracker (the actor when signed in, else the client IP),
 * so a caller cannot multiply its allowance by spreading requests over endpoints.
 * Counters are in-process memory: fine for the single API instance this app runs.
 */
export const rateLimitOptions: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'default', ttl: MINUTE, limit: 600 },
    { name: 'auth', ttl: MINUTE, limit: 20, skipIf: notTagged('auth') },
    { name: 'sensitive', ttl: MINUTE, limit: 30, skipIf: notTagged('sensitive') },
    { name: 'sync', ttl: MINUTE, limit: 120, skipIf: notTagged('sync') },
  ],
  getTracker: (req) => (req as ActorRequest).actor?.userId ?? (req as ActorRequest).ip ?? 'unknown',
  generateKey: (_context, tracker, name) => `${name}:${tracker}`,
};
