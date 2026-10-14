const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SESSION_POLICY = {
  absoluteLifetimeMs: 30 * DAY,
  idleTimeoutMs: 14 * DAY,
  rotateAfterMs: 24 * HOUR,
  /** How long the pre-rotation token keeps working, for requests already in flight. */
  rotationGraceMs: 60 * SECOND,
  touchEveryMs: MINUTE,
  grantCheckEveryMs: 5 * MINUTE,
} as const;

export type SessionTimes = Readonly<{
  expiresAt: Date;
  lastSeenAt: Date;
  rotatedAt: Date;
  grantCheckedAt: Date;
}>;

/** Whether the cookie matched the session's current token or the one it replaced. */
export type TokenMatch = 'current' | 'previous';

export type SessionDecision =
  | { status: 'expired' }
  | { status: 'active'; rotate: boolean; touch: boolean; checkGrant: boolean };

export function decideSession(
  session: SessionTimes,
  match: TokenMatch,
  now: Date,
  policy = SESSION_POLICY,
): SessionDecision {
  const t = now.getTime();
  if (t >= session.expiresAt.getTime()) return { status: 'expired' };
  if (t - session.lastSeenAt.getTime() >= policy.idleTimeoutMs) return { status: 'expired' };
  const sinceRotation = t - session.rotatedAt.getTime();
  if (match === 'previous') {
    return sinceRotation < policy.rotationGraceMs
      ? { status: 'active', rotate: false, touch: false, checkGrant: false }
      : { status: 'expired' };
  }
  return {
    status: 'active',
    rotate: sinceRotation >= policy.rotateAfterMs,
    touch: t - session.lastSeenAt.getTime() >= policy.touchEveryMs,
    checkGrant: t - session.grantCheckedAt.getTime() >= policy.grantCheckEveryMs,
  };
}
