import { test, expect, row } from './fixtures';

// F05: a syllabus in, every deadline checked before anything is written (rule 6).
test.describe('Syllabus import', () => {
  test('nothing is added until it is confirmed, and undated work is kept', async ({ page }) => {
    await page.goto('/plan');
    await page.getByRole('button', { name: 'Import a syllabus' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import a syllabus' });
    await sheet.getByRole('textbox', { name: 'Paste the syllabus' }).fill(
      'Evaluation\nProblem set 1 (5%) due Oct 16\nLab 1 report 7.5%\nMidterm 25% Oct 30 6 p.m.\nTerm project 20%, date TBD',
    );
    await sheet.getByRole('button', { name: 'Read it' }).click();
    // The reader's answer comes back for checking, saying nothing is added yet.
    const check = page.getByRole('dialog', { name: 'Check these' });
    await expect(check.getByText('Nothing is added until you import.')).toBeVisible();
    await expect(check.getByText('Problem set 1')).toBeVisible();
    await expect(check.getByText('Midterm')).toBeVisible();
    await expect(check.getByText('Term project')).toBeVisible();

    // Rule 6: still nothing on Week. Through the tab bar, not page.goto: a
    // reload would reset the in-memory sample and prove nothing.
    await check.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Week' }).click();
    await expect(page.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible();
    await expect(row(page, 'Problem set 1')).toHaveCount(0);
  });

  test('confirming adds the work to the week', async ({ page }) => {
    await page.goto('/plan');
    await page.getByRole('button', { name: 'Import a syllabus' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import a syllabus' });
    await sheet.getByRole('textbox', { name: 'Paste the syllabus' }).fill('Problem set 1 due Oct 16');
    await sheet.getByRole('button', { name: 'Read it' }).click();
    const check = page.getByRole('dialog', { name: 'Check these' });
    await expect(check.getByText('Problem set 1')).toBeVisible();
    await check.getByRole('button', { name: /^(Import|Add)/ }).last().click();
    await expect(check).toBeHidden();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Week' }).click();
    await expect(row(page, 'Problem set 1')).toBeVisible();
  });
});

// F06: typed deadlines, read with no model at all.
test('typed deadlines are previewed before they are added', async ({ page }) => {
  await page.goto('/plan');
  const box = page.getByRole('textbox', { name: /CHEM 233: Lab report/ });
  await box.fill('PHYS 205: Lab 4 writeup, Oct 22, 2h');
  await page.getByRole('button', { name: 'Check what this adds' }).click();
  await expect(page.getByRole('heading', { name: 'Before anything is saved' })).toBeVisible();
  // The year was not written, so the preview says it assumed one.
  await expect(page.getByRole('button', { name: /^Lab 4 writeup assignment Thu, Oct 22 120 min year assumed 2026/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add 1' })).toBeVisible();
});

// F07: repeating work shows every date before it writes any.
test('repeating work previews its dates and needs a day', async ({ page }) => {
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Add repeating work' }).click();
  const sheet = page.getByRole('dialog', { name: 'Repeating work' });
  await sheet.getByRole('textbox', { name: 'What is it' }).fill('Assembly lab');
  await expect(sheet.getByText('Pick at least one day.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add items' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Tue' }).click();
  await expect(sheet.getByRole('button', { name: /^Add \d+/ })).toBeEnabled();
});

// Grades: decided points and what is outstanding, never a prediction.
test('grades show what is banked and what is still to be marked', async ({ page }) => {
  await page.goto('/plan');
  await expect(page.getByText('4.3 of 5 points banked')).toBeVisible();
  await expect(page.getByText('Nothing here is a prediction.')).toBeVisible();
});
