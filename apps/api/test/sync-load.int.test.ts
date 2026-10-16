// Opt-in load test of concurrent pushes against a slowed database (LOAD_TEST=1). Scaled: client
// timeout and backoff are the app's (30 s, 1 s to 5 min) times LOAD_CLIENT_TIMEOUT / 30 s.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SyncService } from '../src/sync/sync.service';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  loginAs,
  resetData,
  type Session,
  SESSION_COOKIE,
  startTestApp,
  TEST_APP_ORIGIN,
  TEST_CLIENT,
  type TestApp,
} from './harness';

const SLOW_MS = Number(process.env.LOAD_SLOW_MS ?? 20);
const CLIENT_TIMEOUT = Number(process.env.LOAD_CLIENT_TIMEOUT ?? 5000);
const DEVICES = Number(process.env.LOAD_DEVICES ?? 6);
const BATCH = 200;
const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob'), person('Cat')] as const;
let provider: FakeOidc;
let t: TestApp;

beforeAll(async () => {
  provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
  t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  await resetData(t.db);
  await t.db.execute(
    sql.raw(`create or replace function zz_slow() returns trigger language plpgsql as $$ begin perform pg_sleep(${SLOW_MS / 1000}); return new; end $$;
    drop trigger if exists zz_slow on sync_mutations; create trigger zz_slow before insert on sync_mutations for each row execute function zz_slow();
    drop trigger if exists zz_slow_tx on transactions; create trigger zz_slow_tx before update on transactions for each row execute function zz_slow();`),
  );
});
afterAll(async () => {
  await t.db.execute(
    sql.raw(
      `drop trigger if exists zz_slow on sync_mutations; drop trigger if exists zz_slow_tx on transactions; drop function if exists zz_slow;`,
    ),
  );
  await t.app.close();
  await provider.close();
});

async function personal(s: Session) {
  const body = (await (await as(t, s, '/v1/workspaces')).json()) as {
    workspaces: { id: string; kind: string }[];
  };
  return body.workspaces.find((w) => w.kind === 'personal')!.id;
}
const mutation = (workspaceId: string) => ({
  mutationId: crypto.randomUUID(),
  type: 'transaction.upsert',
  baseVersion: null,
  transaction: {
    id: crypto.randomUUID(),
    workspaceId,
    kind: 'expense',
    amountMinor: 100,
    currency: 'EUR',
    occurredOn: '2026-10-01',
    accountId: null,
    categoryId: null,
    description: 'x',
    note: '',
  },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it.skipIf(!process.env.LOAD_TEST)(
  'drains concurrent full batches from timing-out devices',
  { timeout: 1_800_000 },
  async () => {
    const [ann, bob, cat] = await Promise.all(people.map((p) => loginAs(t, p.sub)));
    const spaces = await Promise.all([ann!, bob!, cat!].map(personal));
    const svc = t.app.get(SyncService) as unknown as Record<string, (...a: unknown[]) => unknown>;
    let processed = 0;
    const present = svc['present']!.bind(svc);
    svc['present'] = (...a: unknown[]) => {
      processed += 1;
      return present(...a);
    };
    const t0 = Date.now();
    const log: string[] = [];
    const say = (line: string) => {
      log.push(line);
      process.stdout.write(line + '\n');
    };
    const at = () => ((Date.now() - t0) / 1000).toFixed(1);
    let done = 0;
    const device = async (d: number) => {
      const s = d % 2 === 0 ? ann! : bob!;
      const batch = Array.from({ length: BATCH }, () => mutation(spaces[d % 2]!));
      for (let attempt = 1; ; attempt += 1) {
        const started = Date.now();
        try {
          const r = await fetch(`${t.baseUrl}/api/v1/sync/push`, {
            method: 'POST',
            headers: {
              cookie: `${SESSION_COOKIE}=${s.cookie}`,
              'x-csrf-token': s.csrf,
              'content-type': 'application/json',
              origin: TEST_APP_ORIGIN,
            },
            body: JSON.stringify({ mutations: batch }),
            signal: AbortSignal.timeout(CLIENT_TIMEOUT),
          });
          if (r.status !== 200) throw new Error(`status ${r.status} ${await r.text()}`);
          await r.json();
          say(`${at()}s device ${d} ok attempt ${attempt} in ${Date.now() - started}ms`);
          done += 1;
          return attempt;
        } catch (e) {
          say(
            `${at()}s device ${d} attempt ${attempt} failed: ${(e as Error).message.slice(0, 60)}`,
          );
          const ceiling = Math.min(1000 * 2 ** (attempt - 1), 300_000) * (CLIENT_TIMEOUT / 30_000);
          await sleep(ceiling * (0.5 + Math.random() / 2));
        }
      }
    };
    let probing = true;
    const probe = (async () => {
      while (probing) {
        const started = Date.now();
        const r = await as(t, cat!, '/v1/sync/push', {
          method: 'POST',
          body: { mutations: [mutation(spaces[2]!)] },
        });
        say(
          `${at()}s probe ${r.status} ${Date.now() - started}ms processed=${processed} done=${done}`,
        );
        if (done === DEVICES && Date.now() - started < 500) probing = false;
        await sleep(1000);
      }
    })();
    const attempts = await Promise.all(Array.from({ length: DEVICES }, (_, d) => device(d)));
    const clientsDone = at();
    await probe;

    say(
      `SUMMARY slow=${SLOW_MS}ms timeout=${CLIENT_TIMEOUT} devices=${DEVICES} attempts=${attempts.join(',')} clientsDone=${clientsDone}s drained=${at()}s processed=${processed} needed=${DEVICES * BATCH}`,
    );
    expect(processed).toBeGreaterThanOrEqual(DEVICES * BATCH);
  },
);
