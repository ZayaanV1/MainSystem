import { test, expect, openSchedule, openToday, row, toSchedule } from './fixtures';

// F01: open the app and know what to do now, with no navigation (rule 1).
// Since 19 Oct 2026 the widget board answers it; the whole of the work is on
// Schedule.
test.describe('Today', () => {
  test('opens on the widgets, with what is due and a tick for each piece of work', async ({ page }) => {
    await openToday(page);
    await expect(page.getByText('Oct 14', { exact: true })).toBeVisible();
    const board = page.getByRole('region', { name: 'Widgets' });
    await expect(board.getByText('Next due', { exact: true })).toBeVisible();
    await expect(board.getByText('Assignments', { exact: true })).toBeVisible();
    // Finishing work never needs a trip to Schedule.
    await expect(board.getByRole('button', { name: 'Finish WeBWorK set 5' })).toBeVisible();
    // The work list, the inbox and the next-class ribbon are not on Today.
    await expect(page.getByRole('region', { name: 'Work' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Inbox' })).toHaveCount(0);
  });

  test('Schedule holds the whole of the work, and the inbox', async ({ page }) => {
    await openSchedule(page);
    await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible();
    await expect(row(page, 'Lab 3 report: sequential circuits')).toContainText('1 day late');
    await expect(row(page, 'WeBWorK set 5')).toBeVisible();
    await expect(row(page, 'Problem set 4: interference')).toBeVisible();
    // Undated work is kept, never dropped.
    await expect(page.getByRole('heading', { name: /^No date/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible();
  });

  // F02: capture with no required fields, read in plain language, shown before saving.
  test('captures a thought in plain language, shown before it is saved', async ({ page }) => {
    await openToday(page);
    const box = page.getByRole('textbox', { name: 'Capture a thought' });
    await box.fill('lab report thu 5pm phys');
    await expect(page.getByRole('button', { name: /^Due Thu, Oct 15 · 5:00 p\.m\./ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'In PHYS 205. Remove the course' })).toBeVisible();
    await box.press('Enter');
    await toSchedule(page);
    await expect(row(page, 'Lab report')).toContainText('PHYS 205');
    await expect(row(page, 'Lab report')).toContainText('5:00 p.m.');
  });

  test('a capture without a date goes to the inbox, counted on Schedule’s tab', async ({ page }) => {
    await openToday(page);
    const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Schedule/ }).first();
    await expect(tab).toHaveAccessibleName(/2 in the inbox/);
    const box = page.getByRole('textbox', { name: 'Capture a thought' });
    await box.fill('ask about the reading list');
    await expect(page.getByRole('button', { name: 'Add to inbox' })).toBeVisible();
    await box.press('Enter');
    await expect(tab).toHaveAccessibleName(/3 in the inbox/);
    await toSchedule(page);
    await expect(page.getByRole('button', { name: 'ask about the reading list' })).toBeVisible();
  });

  test('a double submit adds one piece of work, not two', async ({ page }) => {
    await openToday(page);
    const box = page.getByRole('textbox', { name: 'Capture a thought' });
    await box.fill('essay outline fri');
    await box.press('Enter');
    await box.press('Enter');
    await toSchedule(page);
    await expect(row(page, 'Essay outline')).toHaveCount(1);
  });

  // F03: finishing is the action that must stay free, and it can be undone.
  test('finishing work from the widget and undoing it', async ({ page }) => {
    await openToday(page);
    const board = page.getByRole('region', { name: 'Widgets' });
    await board.getByRole('button', { name: 'Finish WeBWorK set 5' }).click();
    // The undo bar, not the screen-reader announcer that says the same thing.
    const undo = page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });
    await expect(undo).toContainText('marked done');
    await expect(board.getByRole('button', { name: 'Finish WeBWorK set 5' })).toHaveCount(0);
    // Actual time is offered, never demanded.
    await expect(page.getByText('How long did that take?')).toBeVisible();
    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(board.getByRole('button', { name: 'Finish WeBWorK set 5' })).toBeVisible();
  });

  test('What now picks one task and says why', async ({ page }) => {
    await openToday(page);
    await page.getByRole('button', { name: 'What now', exact: true }).first().click();
    await page.getByRole('button', { name: '30 min' }).click();
    const pick = page.getByRole('button', { name: /^What now · / });
    await expect(pick).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Start on it' })).toBeVisible();
  });

  test('the ⋯ menu edits the widgets and says when the last notification went', async ({ page }) => {
    await openToday(page);
    await page.getByRole('button', { name: 'Today options' }).first().click();
    const menu = page.getByRole('menu', { name: 'Today options' });
    await expect(menu).toContainText('Last notification');
    await menu.getByRole('menuitem', { name: 'Edit widgets' }).click();
    await expect(page.getByText('Drag to move. Tap a widget to change it.')).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText('Drag to move. Tap a widget to change it.')).toHaveCount(0);
  });
});

// F04: open a piece of work, change it, see it move.
test.describe('Editing work', () => {
  test('moving a due date with a quick chip', async ({ page }) => {
    await openSchedule(page);
    await row(page, 'Read chapter 6 and annotate').click();
    const sheet = page.getByRole('dialog', { name: 'Read chapter 6 and annotate' });
    await expect(sheet).toBeVisible();
    // Due opens in place; the quick days are inside it.
    await sheet.getByRole('button', { name: /^Due / }).click();
    const quickDays = sheet.getByRole('group', { name: 'Quick days' });
    await expect(quickDays.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
    await quickDays.getByRole('button', { name: 'Fri 16' }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
    // It now sits under Friday.
    await expect(page.locator('[data-day="2026-10-16"]').getByRole('button', { name: /^Read chapter 6 and annotate/ })).toBeVisible();
  });

  test('deleting takes two taps', async ({ page }) => {
    await openSchedule(page);
    await row(page, 'Read chapter 6 and annotate').click();
    const sheet = page.getByRole('dialog', { name: 'Read chapter 6 and annotate' });
    await sheet.getByRole('button', { name: 'Delete' }).click();
    // One tap must not delete.
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /delete/i }).last().click();
    await expect(sheet).toBeHidden();
    await expect(row(page, 'Read chapter 6 and annotate')).toHaveCount(0);
  });

  test('a link to the work survives a reload', async ({ page }) => {
    await openSchedule(page);
    await row(page, 'Read chapter 6 and annotate').click();
    await expect(page).toHaveURL(/\?work=/);
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Read chapter 6 and annotate' })).toBeVisible();
  });
});
