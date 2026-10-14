import type { Profile, Session } from './session';

export const testProfile: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ann@example.test',
  displayName: 'Ann Example',
  avatarUrl: null,
  locale: 'en',
  theme: 'system',
  timezone: 'Europe/Madrid',
};

export function testSession(profile: Partial<Profile> = {}): Session {
  return { user: { ...testProfile, ...profile }, csrfToken: 'csrf-test' };
}
