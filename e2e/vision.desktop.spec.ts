import { test, expect, openToday, axeViolations } from './fixtures';

// Vision on a desk (lib/vision.ts): the dock and top bar replace the rail,
// Today is the dashboard, and Abood and Courses take their desk layouts.

test.describe('Vision on a desk', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`Today is the dashboard, with no WCAG A or AA violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openToday(page, '?skin=vision');
      await expect(page.locator('.v-dock')).toBeVisible();
      await expect(page.locator('.v-top')).toBeVisible();
      await expect(page.getByRole('region', { name: "This week's load" })).toBeVisible();
      await expect(page.getByRole('region', { name: "Today's timeline" })).toBeVisible();
      // The rail is gone, not merely covered.
      await expect(page.locator('nav.border-r')).toHaveCount(0);
      // Let every entrance finish before measuring contrast.
      await page.waitForTimeout(1600);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test('the dock goes where it says, and Abood and Courses take their desk layouts', async ({ page }) => {
    await openToday(page, '?skin=vision');
    const dock = page.getByRole('navigation', { name: 'Main' });

    await dock.getByRole('button', { name: 'Abood' }).click();
    await expect(page.getByRole('complementary', { name: 'Where Abood answers' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'What Abood remembers' })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(await axeViolations(page)).toEqual([]);

    await dock.getByRole('button', { name: 'Courses' }).click();
    await expect(page.locator('.v-course').first()).toBeVisible();
    await page.waitForTimeout(1200);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('a thought typed in the top bar lands in the inbox', async ({ page }) => {
    await openToday(page, '?skin=vision');
    const box = page.getByLabel('Add something to the inbox');
    await box.fill('Email the TA about the lab');
    await box.press('Enter');
    await expect(box).toHaveValue('');
    await expect(box).toHaveAttribute('placeholder', 'In the inbox');
  });

  test('the glass and the room follow Appearance, and edges line up', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('planner.appearance', JSON.stringify({ version: 2, visionClear: 100, visionBlur: 0, visionDim: 0 })),
    );
    await openToday(page, '?skin=vision');
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-v-clear', 'high');
    const card = page.locator('.v-stat').first();
    await expect(card).toHaveCSS('backdrop-filter', /blur\(0px\)/);
    // The room never dims below what the clearest glass needs.
    const dim = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--v-alpha'));
    expect(Number(dim)).toBeLessThan(0.1);
    // One gutter: content starts the same distance past the dock as it ends before the window's edge.
    // Measured once the entrance has settled, not mid-rise.
    await page.waitForTimeout(1500);
    const dock = await page.locator('.v-dock').boundingBox();
    const dash = await page.locator('.v-dash').boundingBox();
    // The page's own width: a scrollbar, when there is one, is not margin.
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.round(dash!.x - (dock!.x + dock!.width))).toBe(Math.round(vw - (dash!.x + dash!.width)));
  });

  test('every card fills its row, with a mouse as on a real desk', async ({ page }) => {
    // The pointer-desk spacing (index.css) applies only with a fine pointer.
    await page.emulateMedia({});
    await openToday(page, '?skin=vision');
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(() =>
      ['.v-stats', '.v-mid', '.v-low'].map((sel) => {
        const row = document.querySelector(sel)!.getBoundingClientRect();
        return [...document.querySelector(sel)!.children].map((c) => Math.round(row.bottom - c.getBoundingClientRect().bottom));
      }),
    );
    for (const gaps of rows) expect(gaps.every((g) => g === 0)).toBe(true);
  });

  test('Motion: None leaves nothing running', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('planner.appearance', JSON.stringify({ version: 2, motion: 'none' })));
    await openToday(page, '?skin=vision');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'none');
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration) > 0).length,
    );
    expect(running).toBe(0);
    // A change of screen happens at once, with no dissolve in between.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Courses' }).click();
    await expect(page.locator('.v-course').first()).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  });

  test('other themes keep the rail', async ({ page }) => {
    await openToday(page);
    await expect(page.locator('.v-dock')).toHaveCount(0);
  });
});
