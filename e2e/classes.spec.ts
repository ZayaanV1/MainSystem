import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// A class typed by hand, for a school with no calendar file. The clock is
// Wed 14 Oct 2026, 10 a.m. in Toronto, so a term from 5 Oct to 11 Nov crosses
// the end of daylight saving on Sunday 1 Nov. Navigation inside each test is
// by the tab bar: the sample lives in memory and a reload would reset it.

const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true });

/** MATH 205 Lecture, Mon and Wed 10:30 to 11:45 in H-535, 5 Oct to 11 Nov. */
async function fillLecture(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add a class' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a class' });
  await sheet.getByRole('group', { name: 'Course' }).getByRole('button', { name: 'MATH 205' }).click();
  await sheet.getByRole('button', { name: 'Lecture', exact: true }).click();
  await sheet.getByRole('button', { name: 'Monday' }).click();
  await sheet.getByRole('button', { name: 'Wednesday' }).click();
  await sheet.getByLabel('Starts').fill('10:30');
  await sheet.getByRole('button', { name: '1 h 15' }).click();
  await sheet.getByLabel('Room').fill('H-535');
  await sheet.getByLabel('First class').fill('2026-10-05');
  await sheet.getByLabel('Last class').fill('2026-11-11');
  return sheet;
}

async function addLecture(page: Page) {
  await page.goto('/plan');
  const sheet = await fillLecture(page);
  await sheet.getByRole('button', { name: 'Add 12 classes' }).click();
  await expect(sheet.getByRole('status')).toHaveText('12 classes added for MATH 205 Lecture. Add another, or close.');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
}

/** Month's own page. Screens stay mounted, so a bare `main` would also find Courses. */
const month = (page: Page) =>
  page.getByRole('main').filter({ has: page.getByRole('heading', { level: 1, name: /^(October|November) 2026$/ }) });

/** A day in Month, opened, from the month it is in. */
async function openDay(page: Page, label: RegExp, nextMonth = false) {
  await tab(page, 'Month').click();
  await expect(page.getByRole('heading', { name: 'October 2026', level: 1 })).toBeVisible();
  if (nextMonth) {
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('heading', { name: 'November 2026', level: 1 })).toBeVisible();
  }
  await page.getByRole('button', { name: label }).click();
}

test('every session is shown before anything is written', async ({ page }) => {
  await page.goto('/plan');
  const sheet = await fillLecture(page);

  // Twelve Mondays and Wednesdays, the clock change named, the time kept.
  await expect(sheet.locator('.class-count')).toHaveText('12');
  await expect(sheet.getByText('Clocks go back on Sun, Nov 1. Every class stays at 10:30 a.m.')).toBeVisible();
  await expect(sheet.getByText('Saved as MATH 205 Lecture')).toBeVisible();

  // Thanksgiving Monday, skipped with a tap; the count and the button follow.
  await sheet.getByRole('button', { name: 'Mon, Oct 12, already past' }).click();
  await expect(sheet.getByRole('button', { name: 'Mon, Oct 12, skipped, already past' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.class-count')).toHaveText('11');
  await expect(sheet.getByRole('button', { name: 'Add 11 classes' })).toBeEnabled();

  // Rule 6: cancelled, so nothing reached the week.
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await tab(page, 'Week').click();
  await expect(page.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible();
  await expect(page.getByText('MATH 205 Lecture')).toHaveCount(0);
});

test('a class needs a day and an end after its start', async ({ page }) => {
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Add a class' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a class' });
  await sheet.getByRole('button', { name: 'Lecture', exact: true }).click();
  await expect(sheet.getByText('Pick at least one day.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Tuesday' }).click();
  await sheet.getByLabel('Starts').fill('14:00');
  await sheet.getByLabel('Ends').fill('13:00');
  await expect(sheet.getByText('It ends before it starts.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Add/ })).toBeDisabled();
});

test('an added class is on Today, Week and Month, at its time on both sides of the change', async ({ page }) => {
  await addLecture(page);

  // Listed under Your classes.
  const listed = page.getByRole('button', { name: /^MATH 205 Lecture Mon, Wed · 10:30 – 11:45 a\.m\. · H-535/ });
  await expect(listed).toBeVisible();

  // Today, Wednesday at 10: the 10:30 lecture is up next.
  await tab(page, 'Today').click();
  await expect(page.getByRole('region', { name: 'Up next' })).toContainText('MATH 205 Lecture');

  // Week shows today's session.
  await tab(page, 'Week').click();
  await expect(page.getByText('MATH 205 Lecture').first()).toBeVisible();

  // Monday 2 November, after the clocks went back: still 10:30.
  await openDay(page, /^Mon, Nov 2, /, true);
  await expect(month(page).getByText('MATH 205 Lecture').filter({ visible: true })).toBeVisible();
  await expect(month(page).getByText('10:30 – 11:45 a.m.')).toBeVisible();
});

test('changing it from a day moves only the later sessions', async ({ page }) => {
  await addLecture(page);
  await page.getByRole('button', { name: /^MATH 205 Lecture Mon, Wed/ }).click();
  const sheet = page.getByRole('dialog', { name: 'MATH 205 Lecture' });

  // Half an hour later from Mon 26 Oct: six move, the six before stay.
  await sheet.getByLabel('Starts').fill('11:00');
  await sheet.getByLabel('Changes apply from').fill('2026-10-26');
  await expect(sheet.getByText('move to 11:00 a.m. – 12:15 p.m.')).toBeVisible();
  await expect(sheet.locator('.class-diff b').first()).toHaveText('6');
  await expect(sheet.getByText('before Mon, Oct 26 stay exactly as they were')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(sheet).toBeHidden();

  // Monday 19 October kept its time; Monday 26 October moved.
  await openDay(page, /^Mon, Oct 19, /);
  await expect(month(page).getByText('10:30 – 11:45 a.m.')).toBeVisible();
  await page.getByRole('button', { name: /^Mon, Oct 26, / }).click();
  await expect(month(page).getByText('11:00 a.m. – 12:15 p.m.')).toBeVisible();
});

test('ending it removes the sessions after the last one', async ({ page }) => {
  await addLecture(page);
  await page.getByRole('button', { name: /^MATH 205 Lecture Mon, Wed/ }).click();
  const sheet = page.getByRole('dialog', { name: 'MATH 205 Lecture' });
  await sheet.getByRole('button', { name: 'End it' }).click();
  await sheet.getByLabel('Last class').fill('2026-10-21');
  await expect(sheet.getByText('after Wed, Oct 21 are removed')).toBeVisible();
  await expect(sheet.locator('.class-diff b').first()).toHaveText('6');
  await sheet.getByRole('button', { name: 'End the class' }).click();
  await expect(sheet).toBeHidden();

  await expect(page.getByRole('button', { name: /^MATH 205 Lecture .*3 to go · until Wed, Oct 21$/ })).toBeVisible();
  await openDay(page, /^Mon, Nov 2, /, true);
  await expect(month(page).getByText('Nothing due.')).toBeVisible();
  await expect(month(page).getByText('MATH 205 Lecture')).toHaveCount(0);
});

test('deleting it removes what is still to come and keeps what happened', async ({ page }) => {
  await addLecture(page);
  await page.getByRole('button', { name: /^MATH 205 Lecture Mon, Wed/ }).click();
  const sheet = page.getByRole('dialog', { name: 'MATH 205 Lecture' });
  await sheet.getByRole('button', { name: 'Delete it' }).click();
  // Nine from 10:30 today on; three already happened and stay unless asked.
  await expect(sheet.locator('.class-diff')).toContainText('9still to come, removed');
  await expect(sheet.locator('.class-diff')).toContainText('3already happened, kept on the calendar');
  await sheet.getByRole('button', { name: 'Delete the class and 9 sessions' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /^MATH 205 Lecture Mon, Wed/ })).toHaveCount(0);

  await tab(page, 'Today').click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByText('MATH 205 Lecture')).toHaveCount(0);
});
