import { expect, test } from './fixtures';
import { seedEntries } from './support/seed';

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
const screens = [
  ['history', '/transactions'],
  ['entry', '/transactions/new'],
  ['accounts', '/accounts'],
  ['categories', '/categories'],
] as const;

// A tool for looking at the screens, not a check: it runs only when asked for a folder.
test.skip(!OUT, 'set SHOTS_DIR to take screenshots');

test('screenshots', async ({ page, signInAs }) => {
  test.setTimeout(900_000);
  await signInAs('ann');
  await seedEntries(page, 60);
  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /Seed 1 / })).toBeVisible();
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
