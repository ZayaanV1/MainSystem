import { test, expect, openToday } from './fixtures';

// Switching tabs quickly: every tap must land, because nothing covers the page.
test.describe('Switching screens', () => {
  test('rapid taps on the tab bar all land and never start a view transition', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __vt: number }).__vt = 0;
      const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
      const original = doc.startViewTransition?.bind(document);
      if (original) {
        doc.startViewTransition = (cb) => {
          (window as unknown as { __vt: number }).__vt += 1;
          return original(cb);
        };
      }
    });
    await openToday(page);
    const bar = page.getByRole('navigation', { name: 'Main' });

    // No waiting between taps: the next one is sent before the last settles.
    await bar.getByRole('button', { name: /^Schedule/ }).click({ noWaitAfter: true });
    await bar.getByRole('button', { name: 'Month' }).click({ noWaitAfter: true });
    await bar.getByRole('button', { name: /^Schedule/ }).click({ noWaitAfter: true });
    await bar.getByRole('button', { name: 'Today' }).click({ noWaitAfter: true });

    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(0);
  });

  test('Slide still uses the view transition when chosen', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('planner.appearance', JSON.stringify({ tabs: 'slide', version: 2 }));
      (window as unknown as { __vt: number }).__vt = 0;
      const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
      const original = doc.startViewTransition?.bind(document);
      if (original) {
        doc.startViewTransition = (cb) => {
          (window as unknown as { __vt: number }).__vt += 1;
          return original(cb);
        };
      }
    });
    await openToday(page);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Schedule/ }).click();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Schedule/ })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBeGreaterThan(0);
  });
});
