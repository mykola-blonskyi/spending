import { describe, expect, it } from 'vitest';
import { ipTracker } from './rate-limit';

describe('ipTracker', () => {
  it('counts every address of an IPv6 /64 as one client', () => {
    expect(ipTracker('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipTracker('2001:DB8:0001:0002:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(ipTracker('2001:db8:1::5')).toBe('2001:db8:1:0::/64');
    expect(ipTracker('::1')).toBe('0:0:0:0::/64');
    expect(ipTracker('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('keeps IPv4 addresses, including IPv4-mapped ones, whole', () => {
    expect(ipTracker('203.0.113.5')).toBe('203.0.113.5');
    expect(ipTracker('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });
});
