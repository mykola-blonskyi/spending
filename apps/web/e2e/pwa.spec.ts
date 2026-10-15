import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures';
import { E2E_USERS } from './support/env';

const PUSH = '**/api/v1/sync/push';
const dist = resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  process.env.E2E_WEB_DIST ?? 'dist',
);
const badge = (page: Page) =>
  page.getByRole('banner').locator('a[href="/sync"]').getByRole('status');
const updatePrompt = (page: Page) => page.getByText('A new version is available');
const buildMarker = (page: Page) => page.locator('meta[name="e2e-build"]');

/**
 * `deployNextBuild` changes the previewed build in place, as a deploy of a changed shell does:
 * index.html differs and the service worker's precache revision for it changed. The browser's
 * own service worker update check cannot be intercepted by routing, so the files on disk change,
 * and the deployed build is put back after the test.
 */
const test = base.extend<{ deployNextBuild: () => Promise<void> }>({
  deployNextBuild: async ({}, use) => {
    const swPath = join(dist, 'sw.js');
    const htmlPath = join(dist, 'index.html');
    const [sw, html] = await Promise.all([readFile(swPath, 'utf8'), readFile(htmlPath, 'utf8')]);
    try {
      await use(async () => {
        const nextSw = sw.replace(
          /\{url:"index\.html",revision:"[^"]+"\}/,
          '{url:"index.html",revision:"e2e-build-b"}',
        );
        expect(nextSw).not.toBe(sw);
        await writeFile(swPath, nextSw);
        await writeFile(
          htmlPath,
          html.replace('<head>', '<head><meta name="e2e-build" content="b">'),
        );
      });
    } finally {
      await writeFile(swPath, sw);
      await writeFile(htmlPath, html);
    }
  },
});

// The headless shell reports no installability errors at all; full Chromium runs Chrome's own
// check, the one Lighthouse's installable-manifest audit reported.
test.use({ channel: 'chromium' });

async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

async function openControlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test('the production build is installable, with token colours and a maskable icon', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await openControlled(page);

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  // Every Playwright context is off the record, which alone blocks installing.
  expect(installabilityErrors.map((error) => error.errorId)).toEqual(['in-incognito']);
  const { url } = await cdp.send('Page.getAppManifest');
  const manifest = await page.evaluate((href) => fetch(href).then((r) => r.json()), url);
  expect(manifest).toMatchObject({
    name: 'Spending',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#006944',
    background_color: '#fafaf9',
  });
  expect(manifest.icons).toContainEqual(expect.objectContaining({ purpose: 'maskable' }));
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(`/${icon.src}`)).ok()).toBe(true);
  }
});

test('a new version is offered, activates on reload, and queued changes still sync', async ({
  page,
  context,
  signInAs,
  db,
  deployNextBuild,
}) => {
  await signInAs('ann');
  await openControlled(page);

  await context.route(PUSH, (route) => route.abort('internetdisconnected'));
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill('9');
  await page.getByLabel('Description').fill('Queued across the update');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(badge(page)).toHaveText('Retrying…');

  await deployNextBuild();
  await checkForUpdate(page);
  await expect(updatePrompt(page)).toBeVisible();
  await expect(buildMarker(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(buildMarker(page)).toHaveAttribute('content', 'b');
  await expect(updatePrompt(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Queued across the update/ })).toBeVisible();
  expect(await db.transactions(E2E_USERS.ann.email)).toEqual([]);

  await context.unroute(PUSH);
  await expect(badge(page)).toHaveText('Up to date');
  expect(await db.transactions(E2E_USERS.ann.email)).toMatchObject([
    { description: 'Queued across the update', amount_minor: 900, deleted: false },
  ]);
});

test('a tab with unsaved input is never reloaded by an update another tab accepted', async ({
  page,
  context,
  signInAs,
  deployNextBuild,
}) => {
  await signInAs('ann');
  await openControlled(page);
  const typing = await context.newPage();
  await typing.goto('/transactions/new');
  await typing.getByLabel('Description').fill('Half-typed entry');
  let typingLoads = 0;
  typing.on('load', () => (typingLoads += 1));
  await typing.evaluate(() =>
    Object.assign(window, {
      e2eControllerChange: new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve),
      ),
    }),
  );

  await deployNextBuild();
  await checkForUpdate(page);
  await expect(updatePrompt(page)).toBeVisible();
  await expect(updatePrompt(typing)).toBeVisible();

  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(buildMarker(page)).toHaveAttribute('content', 'b');
  await typing.evaluate(
    () => (window as unknown as { e2eControllerChange: Promise<void> }).e2eControllerChange,
  );

  await expect(updatePrompt(typing)).toBeVisible();
  await expect(typing.getByLabel('Description')).toHaveValue('Half-typed entry');
  await expect(buildMarker(typing)).toHaveCount(0);
  expect(typingLoads).toBe(0);

  await typing.getByRole('button', { name: 'Reload' }).click();
  await expect(buildMarker(typing)).toHaveAttribute('content', 'b');
});
