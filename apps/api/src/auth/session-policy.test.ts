import { describe, expect, it } from 'vitest';
import { decideSession, SESSION_POLICY, type SessionTimes } from './session-policy';

const now = new Date('2026-10-14T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const fresh: SessionTimes = {
  expiresAt: new Date(now.getTime() + SESSION_POLICY.absoluteLifetimeMs),
  lastSeenAt: now,
  rotatedAt: now,
  grantCheckedAt: now,
};

describe('decideSession', () => {
  it('keeps a fresh session without side effects', () => {
    expect(decideSession(fresh, 'current', now)).toEqual({
      status: 'active',
      rotate: false,
      touch: false,
      checkGrant: false,
    });
  });

  it('expires at the absolute lifetime', () => {
    expect(decideSession({ ...fresh, expiresAt: now }, 'current', now)).toEqual({
      status: 'expired',
    });
  });

  it('expires after the idle timeout', () => {
    const idle = { ...fresh, lastSeenAt: ago(SESSION_POLICY.idleTimeoutMs) };
    expect(decideSession(idle, 'current', now).status).toBe('expired');
  });

  it('touches at most once per minute', () => {
    const seen = (ms: number) => decideSession({ ...fresh, lastSeenAt: ago(ms) }, 'current', now);
    expect(seen(59_000)).toMatchObject({ touch: false });
    expect(seen(60_000)).toMatchObject({ touch: true });
  });

  it('rotates after 24 hours', () => {
    const rotated = (ms: number) => decideSession({ ...fresh, rotatedAt: ago(ms) }, 'current', now);
    expect(rotated(SESSION_POLICY.rotateAfterMs - 1)).toMatchObject({ rotate: false });
    expect(rotated(SESSION_POLICY.rotateAfterMs)).toMatchObject({ rotate: true });
  });

  it('re-checks the grant after 5 minutes', () => {
    const checked = { ...fresh, grantCheckedAt: ago(SESSION_POLICY.grantCheckEveryMs) };
    expect(decideSession(checked, 'current', now)).toMatchObject({ checkGrant: true });
  });

  it('honours a replaced token only within the grace window and never acts on it', () => {
    const replaced = (ms: number) =>
      decideSession(
        { ...fresh, rotatedAt: ago(ms), grantCheckedAt: ago(SESSION_POLICY.grantCheckEveryMs) },
        'previous',
        now,
      );
    expect(replaced(SESSION_POLICY.rotationGraceMs - 1)).toEqual({
      status: 'active',
      rotate: false,
      touch: false,
      checkGrant: false,
    });
    expect(replaced(SESSION_POLICY.rotationGraceMs)).toEqual({ status: 'expired' });
  });
});
