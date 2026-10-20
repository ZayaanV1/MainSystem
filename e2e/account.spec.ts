import { test, expect, openToday, toSchedule } from './fixtures';

// F08: signed out, the first screen is sign-in with a way back from a lost password.
test.describe('Signed out', () => {
  test('offers sign in, a new account and a password reset', async ({ page }) => {
    await page.goto('/?signedout');
    await expect(page.getByRole('heading', { name: 'Planner', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Sign in' })).toBeChecked();
    await page.getByRole('radio', { name: 'New account' }).check();
    await expect(page.getByRole('radio', { name: 'New account' })).toBeChecked();
    await page.getByRole('radio', { name: 'Sign in' }).check();
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('the password can be shown', async ({ page }) => {
    await page.goto('/?signedout');
    const field = page.getByRole('textbox', { name: 'Password' });
    await expect(field).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(field).toHaveAttribute('type', 'text');
  });
});

// F09: the first run, every step skippable, nothing pre-selected.
test('the first run can be skipped all the way to Today', async ({ page }) => {
  await page.goto('/?firstrun');
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 6; i++) {
    const skip = page.getByRole('button', { name: /^(Skip this step|Skip|Open my planner)$/ }).first();
    if (!(await skip.isVisible().catch(() => false))) break;
    await skip.click();
  }
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
});

// F10: the user's data can always leave (rule 5, and the export guard).
test('export downloads every table as JSON', async ({ page }) => {
  await page.goto('/settings/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^life-planner-.*\.json$/);
  const body = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  const text = JSON.stringify(body);
  expect(text).toContain('WeBWorK set 5');
  expect(text).toContain('Computer Organization');
});

// F11: offline, a capture still lands and nothing is lost. The sheets are
// fetched first, as the service worker has them cached in the built app; what
// happens when they are not is BUG-002 in e2e/BUGS.md.
test('a capture made offline shows at once and is still there online', async ({ page, context }) => {
  await openToday(page);
  // Schedule's code is fetched while online, as the built app's worker has it.
  await toSchedule(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  const box = page.getByRole('textbox', { name: 'Capture a thought' });
  await box.fill('read the lab handout fri');
  await box.press('Enter');
  await toSchedule(page);
  await expect(page.getByRole('button', { name: /^Read the lab handout / })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: /^Read the lab handout / })).toBeVisible();
});
