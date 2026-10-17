import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ActorRequest } from './actor';
import { ApiError } from './errors';

const MINUTE = 60_000;
const RATE_LIMIT_TAG = Symbol('RATE_LIMIT_TAG');

/** Named budgets a route opts into on top of the global default. */
export type RateLimitName = 'auth' | 'sensitive';

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
  ],
  getTracker: (req) => {
    const { actor, ip } = req as ActorRequest;
    return actor?.userId ?? (ip ? ipTracker(ip) : 'unknown');
  },
  generateKey: (_context, tracker, name) => `${name}:${tracker}`,
};

/**
 * Every sync mutation holds the single ledger lock, so a push costs its mutation count. 2000 a
 * minute lets an offline queue of a few hundred through in one or two pushes, and keeps one user
 * to about a fifth of what the lock serializes. Charged before the body is validated.
 */
export const SYNC_MUTATIONS_PER_MINUTE = 2000;

@Injectable()
export class SyncMutationBudget implements CanActivate {
  private readonly windows = new Map<string, { startedAt: number; used: number }>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ActorRequest>();
    const mutations = (req.body as { mutations?: unknown } | undefined)?.mutations;
    const cost = Array.isArray(mutations) ? mutations.length : 1;
    const key = req.actor!.userId;
    const now = Date.now();
    const current = this.windows.get(key);
    const window =
      current && now - current.startedAt < MINUTE ? current : { startedAt: now, used: 0 };
    if (window.used + cost > SYNC_MUTATIONS_PER_MINUTE) throw new ApiError('RATE_LIMITED');
    window.used += cost;
    this.windows.set(key, window);
    return true;
  }
}

/**
 * An IPv6 client usually holds a whole /64, so it is one tracker; otherwise rotating addresses
 * would reset every budget. An IPv4-mapped address counts as the IPv4 address.
 */
export function ipTracker(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.split('%')[0]!.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const groups = [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}
