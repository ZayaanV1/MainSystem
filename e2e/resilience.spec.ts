import { test, expect, openToday } from './fixtures';
import type { Page } from '@playwright/test';

/** Next due on Today's board: its title opens the work. */
const nextDue = (page: Page) =>
  page.locator('.bw-w[data-type="due"]').getByRole('button', { name: 'WeBWorK set 5', exact: true });

/**
 * A screen's code that fails to download must cost that screen, once — not
 * Today, and not the rest of the session.
 *
 * BUG-002 in e2e/BUGS.md: one failed download of the editor used to replace
 * all of Today with "This screen couldn't be shown", and React's lazy() kept
 * the failed import, so it stayed broken until a reload. In the built app the
 * service worker usually has the file, which is why it was rare: a cold
 * offline start, or the moment a new version activates. Fixed by
 * src/lib/lazyRetry.tsx.
 */
test.describe('Code that will not download', () => {
  // The blocked download and React's report of it are this test's own doing.
  test.use({ allowErrors: /ERR_INTERNET_DISCONNECTED|AssignmentEditor|Week\.tsx|dynamically imported module/ });

  test('leaves Today usable, says so, and opens on Try again once the network is back', async ({ page }) => {
    let block = true;
    await page.route(/\/src\/routes\/AssignmentEditor\.tsx/, (r) => (block ? r.abort('internetdisconnected') : r.continue()));
    await openToday(page);
    await nextDue(page).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Couldn’t load this' });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Capture a thought' })).toBeVisible();

    block = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('dialog', { name: 'WeBWorK set 5' })).toBeVisible();
    await expect(alert).toBeHidden();
  });

  test('Close puts the bar away and Today carries on', async ({ page }) => {
    await page.route(/\/src\/routes\/AssignmentEditor\.tsx/, (r) => r.abort('internetdisconnected'));
    await openToday(page);
    await nextDue(page).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Couldn’t load this' });
    await alert.getByRole('button', { name: 'Close' }).click();
    await expect(alert).toBeHidden();
    await page.getByRole('button', { name: 'Finish WeBWorK set 5' }).click();
    await expect(page.getByRole('button', { name: 'Finish WeBWorK set 5' })).toHaveCount(0);
  });

  test('a whole screen recovers the same way', async ({ page }) => {
    let block = true;
    await page.route(/\/src\/routes\/Week\.tsx/, (r) => (block ? r.abort('internetdisconnected') : r.continue()));
    await openToday(page);
    const tabs = page.getByRole('navigation', { name: 'Main' });
    await tabs.getByRole('button', { name: /^Schedule/ }).first().click();
    const alert = page.getByRole('alert').filter({ hasText: 'Couldn’t load this' });
    await expect(alert).toBeVisible();
    // A screen has nothing to close; the tab bar is the way out.
    await expect(alert.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await expect(tabs).toBeVisible();
    block = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
  });
});
