import type { Page } from '@playwright/test';
import { test, expect, row, axeViolations, openToday } from './fixtures';

/**
 * The iPad. The tablet project holds one upright (820 x 1180, an iPad Air)
 * with touch and no hover, so the app sees what Safari on an iPad reports.
 * Turned on its side it crosses into the desk layout, which is checked here
 * under touch rather than a mouse.
 *
 * Until 13 Oct 2026 an upright iPad got the phone column: 640 px with 90 px
 * of nothing either side, a tab bar wider than the page it served, and chip
 * rows cut mid-pill at the column's edge.
 */

const SCREENS = ['/', '/week', '/month', '/search', '/ask', '/plan', '/settings'];

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Each element fully on screen, none cut off at either edge. */
async function allOnScreen(page: Page, selector: string) {
  const width = page.viewportSize()!.width;
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent?.trim().slice(0, 30), left: r.left, right: r.right };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  return boxes.filter((b) => b.left < 0 || b.right > width);
}

test.describe('upright', () => {
  test('no screen scrolls sideways', async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await sideways(page), screen).toBe(0);
    }
  });

  test('the tab bar holds every destination, centred, with no More', async ({ page }) => {
    await openToday(page);
    const bar = page.locator('nav[aria-label="Main"]:visible');
    await expect(bar.getByRole('button')).toHaveText(['Today', 'Week', 'Month', 'Search', 'Abood', 'Courses', 'Settings']);
    const box = (await bar.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.width).toBeLessThanOrEqual(640);
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    // Courses is one tap away, not two.
    await bar.getByRole('button', { name: 'Courses' }).click();
    await expect(page.getByRole('heading', { name: 'Courses and syllabus', level: 1 })).toBeVisible();
  });

  test('Today answers What now beside the work, without being asked', async ({ page }) => {
    await openToday(page);
    await expect(page.getByRole('button', { name: 'Start on it' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'What now?' })).toHaveCount(0);
    // The inbox sits beside the work too: on the first screen, not below it.
    const inbox = (await page.getByRole('heading', { name: 'Inbox' }).boundingBox())!;
    expect(inbox.y).toBeLessThan(page.viewportSize()!.height);
  });

  test('chip rows wrap instead of cutting a pill at the edge', async ({ page }) => {
    await openToday(page);
    expect(await allOnScreen(page, '[role="group"][aria-label="Checklist"] > *')).toEqual([]);
    await page.locator('nav[aria-label="Main"]:visible').getByRole('button', { name: 'Week' }).click();
    await expect(page.getByRole('group', { name: 'Show one course' }).getByRole('button', { name: 'PHYS 205' })).toBeVisible();
    expect(await allOnScreen(page, '[role="group"][aria-label="Show one course"] button')).toEqual([]);
  });

  test('a sheet rises as a centred column, not a slab across the screen', async ({ page }) => {
    await openToday(page);
    await row(page, 'Lab 3 report: sequential circuits').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(640);
    expect(Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
  });

  test('turning to tablet width with More open leaves nothing over the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openToday(page);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.locator('.sheet-scrim')).toHaveCount(0);
    await page.locator('nav[aria-label="Main"]:visible').getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('Today and Week meet WCAG AA', async ({ page }) => {
    await openToday(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.locator('nav[aria-label="Main"]:visible').getByRole('button', { name: 'Week' }).click();
    await expect(page.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('on its side', () => {
  test.use({ viewport: { width: 1180, height: 820 } });

  test('the rail replaces the tab bar and nothing scrolls sideways', async ({ page }) => {
    await openToday(page);
    const nav = page.locator('nav[aria-label="Main"]:visible');
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole('button')).toHaveCount(7);
    expect((await nav.boundingBox())!.height).toBeGreaterThan(700);
    for (const screen of SCREENS) {
      await page.goto(screen);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await sideways(page), screen).toBe(0);
    }
  });

  test('a touch screen keeps the full tap floor', async ({ page }) => {
    await openToday(page);
    const tap = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tap').trim());
    expect(tap).toBe('44px');
  });

  test('the editor docks as a full-height panel on the right', async ({ page }) => {
    await openToday(page);
    await row(page, 'Lab 3 report: sequential circuits').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // The panel slides in from the edge; measure once it has arrived.
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.x + (await sheet.boundingBox())!.width)).toBe(1180);
    const box = (await sheet.boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBe(820);
  });

  test('Today meets WCAG AA', async ({ page }) => {
    await openToday(page);
    expect(await axeViolations(page)).toEqual([]);
  });
});
