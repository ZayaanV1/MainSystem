import { test, expect, openToday, row } from './fixtures';

/**
 * A screen's code that fails to download must cost that screen, once — not
 * Today, and not the rest of the session.
 *
 * BUG-002 in e2e/BUGS.md: today, one failed download of the editor
 * replaces all of Today with "This screen couldn't be shown", and React's
 * lazy() keeps the failed import, so it stays broken until a reload. In the
 * built app the service worker usually has the file, which is why this is
 * rare: a cold offline start, or the moment a new version activates.
 *
 * Marked as a known failure until fixed; it turns red when the fix lands, so
 * the mark gets removed.
 */
test('a failed download of the editor leaves Today usable, and works once the network is back', async ({ page }) => {
  test.fail(true, 'BUG-002');
  // The uncaught import error is the bug's own symptom, not a separate failure.
  page.on('pageerror', () => {});
  let block = true;
  await page.route(/\/src\/routes\/AssignmentEditor\.tsx/, (r) => (block ? r.abort('internetdisconnected') : r.continue()));
  await openToday(page);
  await row(page, 'Read chapter 6 and annotate').click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Capture a thought' })).toBeVisible();

  block = false;
  await row(page, 'Read chapter 6 and annotate').click();
  await expect(page.getByRole('dialog', { name: 'Read chapter 6 and annotate' })).toBeVisible();
});
