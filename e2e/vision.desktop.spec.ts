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

  test('other themes keep the rail', async ({ page }) => {
    await openToday(page);
    await expect(page.locator('.v-dock')).toHaveCount(0);
  });
});
