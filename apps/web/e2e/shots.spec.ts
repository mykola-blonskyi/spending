import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';
import { createAccount, seedEntries } from './support/seed';

const LAYOUTS = {
  calm: 'Calm minimal',
  cards: 'Card stack',
  soft: 'Soft and friendly',
  journal: 'Journal',
  bento: 'Bento',
  split: 'Split view',
  playful: 'Playful',
  hybrid: 'Hybrid',
} as const;

const OUT = process.env.SHOTS_DIR;
const only = (process.env.SHOT_LAYOUTS ?? Object.keys(LAYOUTS)).toString().split(',');
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// A tool for looking at the screens, not a check: it runs only when asked for a folder.
test.skip(!OUT, 'set SHOTS_DIR to take screenshots');

test('screenshots', async ({ page, signInAs, db }) => {
  test.setTimeout(900_000);
  // USD and GBP convert; one CHF entry stays unconverted.
  for (let offset = 0; offset > -16; offset -= 1) {
    await db.insertFxRate({
      date: day(offset),
      currency: 'USD',
      ratePerEur: '1.0850',
      source: 'ecb',
    });
    await db.insertFxRate({
      date: day(offset),
      currency: 'GBP',
      ratePerEur: '0.8400',
      source: 'ecb',
    });
  }
  await signInAs('ann');
  await seedEntries(page, 60);
  await createAccount(page, { name: 'Swiss card', kind: 'card', currency: 'CHF' });
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill('5.00');
  await page.getByLabel('Description').fill('Zurich tram');
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: /Swiss card/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: /Seed 1 / })).toBeVisible();
  const stored = () => db.transactions(E2E_USERS.ann.email);
  await expect.poll(async () => (await stored()).length).toBe(61);
  const usd = (await stored()).find((t) => t.description === 'Seed 3 Housing')!;
  const chf = (await stored()).find((t) => t.description === 'Zurich tram')!;
  const screens = [
    ['history', '/transactions'],
    ['entry', '/transactions/new'],
    ['edit-usd', `/transactions/${usd.id}`],
    ['edit-chf', `/transactions/${chf.id}`],
    ['accounts', '/accounts'],
    ['categories', '/categories'],
  ] as const;
  for (const layout of only as (keyof typeof LAYOUTS)[]) {
    await page.goto('/settings');
    await page.getByRole('radio', { name: LAYOUTS[layout] }).click();
    await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', layout);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/settings');
      await page.getByRole('radio', { name: scheme === 'dark' ? 'Dark' : 'Light' }).click();
      for (const [width, height, device] of [
        [390, 844, 'mobile'],
        [1440, 900, 'desktop'],
      ] as const) {
        await page.setViewportSize({ width, height });
        for (const [name, path] of screens) {
          await page.goto(path);
          await page.waitForTimeout(400);
          await page.screenshot({
            path: `${OUT}/${layout}-${name}-${device}-${scheme}.png`,
            fullPage: name !== 'history',
          });
        }
      }
    }
  }
});
