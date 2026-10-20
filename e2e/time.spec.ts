import { test, expect, openToday, row, toSchedule } from './fixtures';

// Rule 7 and the confidently-wrong-deadline failure the spec names. A day is
// the account's local day, the account's zone wins over the device's, and a
// deadline keeps its wall-clock time across a DST change.

test.describe('A phone in another time zone', () => {
  test.use({ timezoneId: 'America/Vancouver' });

  test('shows the account zone, not the device zone', async ({ page }) => {
    await openToday(page);
    await expect(page.getByText('Oct 14 · EDT')).toBeVisible();
    // Due Tuesday 5 p.m. in Toronto; must not read 2 p.m., nor land on Monday.
    await toSchedule(page);
    const tuesday = page.locator('[data-day="2026-10-20"]');
    await expect(tuesday.getByRole('button', { name: /^Assembly assignment 2/ })).toContainText('5:00 p.m.');
  });
});

test.describe('Across the end of daylight saving time', () => {
  // Saturday 31 Oct 2026, 10 a.m. EDT. Clocks go back on Sunday 1 Nov.
  test.use({ clockAt: new Date('2026-10-31T14:00:00.000Z') });

  test('a deadline after the change keeps its wall-clock time', async ({ page }) => {
    await openToday(page);
    await expect(page.getByText('Oct 31', { exact: true })).toBeVisible();
    // Sample: due six days from today at 5 p.m., which falls in EST.
    await toSchedule(page);
    await expect(row(page, 'Assembly assignment 2')).toContainText('5:00 p.m.');
  });

  test('the week across the change still has seven days', async ({ page }) => {
    await page.goto('/week');
    await expect(page.getByRole('group', { name: /Work due each day/ }).getByRole('button')).toHaveCount(7);
  });
});

test.describe('Just before midnight', () => {
  // Wednesday 14 Oct, 11:58 p.m. in Toronto, already Thursday in UTC.
  test.use({ clockAt: new Date('2026-10-15T03:58:00.000Z') });

  test('today is still Wednesday', async ({ page }) => {
    await openToday(page);
    await expect(page.getByText('Oct 14', { exact: true })).toBeVisible();
    await expect(page.getByText('Wednesday', { exact: true })).toBeVisible();
  });
});
