import { test, expect, axeViolations } from './fixtures';

// AI apps connecting (functions/mcp): the consent page Supabase's OAuth server
// sends them to, and Settings > Connected apps, where they are disconnected
// and their changes undone.

test('the consent page names the app, says what it can and cannot do, and allow goes back', async ({ page }) => {
  await page.goto('/oauth/consent?authorization_id=sample-auth&connected');
  await expect(page.getByRole('heading', { name: 'Connect Claude' })).toBeVisible();
  await expect(page.getByText('Delete anything')).toBeVisible();
  await expect(page.getByText(/claude\.ai/)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page).toHaveURL(/connected=allowed/);
});

test('a broken consent link says what to do', async ({ page }) => {
  await page.goto('/oauth/consent?authorization_id=nope');
  await expect(page.getByText(/Start connecting again/)).toBeVisible();
});

test('Connected apps lists the app, undoes a change, and disconnects', async ({ page }) => {
  await page.goto('/settings/connected');
  await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible();
  await expect(page.getByText(/functions\/v1\/mcp/)).toBeVisible();
  await expect(page.getByText('Claude', { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await axeViolations(page)).toEqual([]);

  const change = page.getByText(/email the TA about office hours/);
  await expect(change).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/· Undone/)).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('No apps are connected.')).toBeVisible();
});
