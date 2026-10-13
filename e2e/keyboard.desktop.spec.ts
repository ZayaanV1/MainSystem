import { test, expect, openToday, row } from './fixtures';

// Desktop only: the keyboard and the mouse.

test('the command palette opens with a shortcut and goes where it is told', async ({ page }) => {
  await openToday(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await page.keyboard.type('week');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible();
});

test('dragging work to another day moves it, and it can be undone', async ({ page }) => {
  await page.goto('/week');
  await expect(page.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible();
  const card = row(page, 'Read chapter 6 and annotate');
  await card.scrollIntoViewIfNeeded();
  // The day's own drop area in the list, not the strip of days above it.
  const target = page.locator('[data-day="2026-10-17"]').last();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('row or day not on screen');
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(card).toContainText('Sat');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toContainText('Thu');
});
