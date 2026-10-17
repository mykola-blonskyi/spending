import { describe, expect, it } from 'vitest';
import { migrationDatabaseUrl } from './migrate';

describe('migrationDatabaseUrl', () => {
  const app = 'postgres://spending_app:a@db:5432/spending';
  const owner = 'postgres://spending_owner:b@db:5432/spending';

  it('prefers the owner role when MIGRATION_DATABASE_URL is set', () => {
    expect(migrationDatabaseUrl({ DATABASE_URL: app, MIGRATION_DATABASE_URL: owner })).toBe(owner);
  });

  it.each([undefined, ''])('falls back to DATABASE_URL when it is %j', (value) => {
    expect(migrationDatabaseUrl({ DATABASE_URL: app, MIGRATION_DATABASE_URL: value })).toBe(app);
  });
});
