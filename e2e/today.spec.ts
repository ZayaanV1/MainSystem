import { test, expect, openToday, row } from './fixtures';

// F01: open the app and know what to do now, with no navigation (rule 1).
test.describe('Today', () => {
  test('opens on Today with the day already sorted', async ({ page }) => {
    await openToday(page);
    await expect(page.getByText('Oct 14 · EDT')).toBeVisible();
    const work = page.getByRole('region', { name: 'Work' });
    await expect(work.getByRole('button', { name: 'Late 1 item' })).toBeVisible();
    await expect(row(page, 'Lab 3 report: sequential circuits')).toContainText('1 day late');
    await expect(work.getByRole('button', { name: 'Today 2 items' })).toBeVisible();
    await expect(row(page, 'WeBWorK set 5')).toBeVisible();
    await expect(row(page, 'Problem set 4: interference')).toBeVisible();
    // Undated work is kept, never dropped.
    await expect(work.getByRole('button', { name: 'No date 1 item' })).toBeVisible();
  });

  // F02: capture with no required fields, read in plain language, shown before saving.
  test('captures a thought in plain language, shown before it is saved', async ({ page }) => {
    await openToday(page);
    const box = page.getByRole('textbox', { name: 'Capture a thought' });
    await box.fill('lab report thu 5pm phys');
    await expect(page.getByRole('button', { name: /^Due Thu, Oct 15 · 5:00 p\.m\./ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'In PHYS 205. Remove the course' })).toBeVisible();
    await box.press('Enter');
    await expect(row(page, 'Lab report')).toContainText('PHYS 205');
    await expect(row(page, 'Lab report')).toContainText('Thu 5:00 p.m.');
    await expect(page.getByRole('button', { name: 'Tomorrow 2 items' })).toBeVisible();
  });

  test('a capture without a date goes to the inbox', async ({ page }) => {
    await openToday(page);
    const box = page.getByRole('textbox', { name: 'Capture a thought' });
    await box.fill('ask about the reading list');
    await expect(page.getByRole('button', { name: 'Add to inbox' })).toBeVisible();
    await box.press('Enter');
    await expect(page.getByRole('button', { name: 'ask about the reading list' })).toBeVisible();
  });

  test('a double submit adds one piece of work, not two', async ({ page }) => {
    await openToday(page);
    const box = page.getByRole('textbox', { name: 'Capture a thought' });
    await box.fill('essay outline fri');
    await box.press('Enter');
    await box.press('Enter');
    await expect(row(page, 'Essay outline')).toHaveCount(1);
  });

  // F03: finishing is the action that must stay free, and it can be undone.
  test('finishing work and undoing it', async ({ page }) => {
    await openToday(page);
    await page.getByRole('button', { name: 'Mark WeBWorK set 5 done, due today' }).click();
    // The undo bar, not the screen-reader announcer that says the same thing.
    const undo = page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });
    await expect(undo).toContainText('marked done');
    await expect(row(page, 'WeBWorK set 5')).toHaveCount(0);
    // Actual time is offered, never demanded.
    await expect(page.getByText('How long did that take?')).toBeVisible();
    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(row(page, 'WeBWorK set 5')).toBeVisible();
  });

  test('What now picks one task and says why', async ({ page }) => {
    await openToday(page);
    await page.getByRole('button', { name: 'What now?' }).click();
    await page.getByRole('button', { name: '30 min' }).click();
    const pick = page.getByRole('button', { name: /^What now · / });
    await expect(pick).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Start on it' })).toBeVisible();
  });

  // Rule: low-battery mode offers ONE task, small and soon, never the most
  // overdue. Regression for BUG-001 in e2e/BUGS.md.
  test('low-battery mode keeps the essentials and one task that is not the overdue one', async ({ page }) => {
    await openToday(page);
    await page.getByRole('button', { name: 'Low battery' }).click();
    await expect(page.getByText('Just the essentials.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'If you have it in you' })).toBeVisible();
    await expect(row(page, 'WeBWorK set 5')).toBeVisible();
    await expect(row(page, 'Lab 3 report: sequential circuits')).toHaveCount(0);
    // Hidden work is counted, never named.
    await expect(page.getByText(/other things are hidden\. They keep\./)).toBeVisible();
    await page.getByRole('button', { name: 'Show everything' }).click();
    await expect(row(page, 'Lab 3 report: sequential circuits')).toBeVisible();
  });
});

// F04: open a piece of work, change it, see it move.
test.describe('Editing work', () => {
  test('moving a due date with a quick chip', async ({ page }) => {
    await openToday(page);
    await row(page, 'Read chapter 6 and annotate').click();
    const sheet = page.getByRole('dialog', { name: 'Read chapter 6 and annotate' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Due' }).getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('group', { name: 'Due' }).getByRole('button', { name: 'Fri 16' }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
    await expect(row(page, 'Read chapter 6 and annotate')).toContainText('Fri');
  });

  test('deleting takes two taps', async ({ page }) => {
    await openToday(page);
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
    await openToday(page);
    await row(page, 'Read chapter 6 and annotate').click();
    await expect(page).toHaveURL(/\?work=/);
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Read chapter 6 and annotate' })).toBeVisible();
  });
});
