import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/bootstrap';
import { parseConfig } from '../src/common/config';
import { DB, type Db } from '../src/database/database.module';
import { testDatabaseUrl } from './env';

export type TestApp = { app: NestExpressApplication; db: Db; baseUrl: string };

export async function startTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const app = await createApp(
    parseConfig({ NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl, ...env }),
  );
  await app.listen(0, '127.0.0.1');
  return { app, db: app.get<Db>(DB), baseUrl: await app.getUrl() };
}

export async function resetData(db: Db): Promise<void> {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
  await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}
