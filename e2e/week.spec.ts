import { test, expect, row } from './fixtures';

// F12: the week at a glance, filterable, editable in bulk.
test.describe('Week', () => {
  test('shows seven days with the hours of work on each', async ({ page }) => {
    await page.goto('/week');
    await expect(page.getByText('Oct 14–20 · 12.3 h of work')).toBeVisible();
    const strip = page.getByRole('group', { name: /Work due each day/ });
    await expect(strip.getByRole('button')).toHaveCount(7);
    await expect(strip.getByRole('button', { name: 'Saturday 17, 4h of work' })).toBeVisible();
    // Exams sit on their day.
    await expect(page.getByText('PHYS 205 Midterm')).toBeVisible();
  });

  test('one course at a time', async ({ page }) => {
    await page.goto('/week');
    await page.getByRole('button', { name: 'Week options' }).first().click();
    await page.getByRole('menuitemradio', { name: 'PHYS 205' }).click();
    await expect(row(page, 'Problem set 4: interference')).toBeVisible();
    await expect(row(page, 'WeBWorK set 5')).toHaveCount(0);
  });

  test('selecting several and moving them together', async ({ page }) => {
    await page.goto('/week');
    await page.getByRole('button', { name: 'Week options' }).first().click();
    await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
    await row(page, 'WeBWorK set 5').click();
    await row(page, 'Problem set 4: interference').click();
    const bar = page.getByRole('toolbar', { name: 'Selected work' });
    await expect(bar).toContainText('2');
  });

  test('Month shows how much is due each day', async ({ page }) => {
    await page.goto('/month');
    await expect(page.getByRole('heading', { name: 'October 2026', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wed, Oct 14, 5 due' })).toBeVisible();
  });
});

// F13: search finds work by what you remember of it.
test('search finds work and courses', async ({ page }) => {
  await page.goto('/search');
  await page.getByRole('textbox', { name: 'Search' }).fill('webw');
  await expect(page.getByRole('button', { name: /WeBWorK set 5/ }).first()).toBeVisible();
});
