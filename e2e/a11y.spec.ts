import { test, expect, openToday, row, axeViolations } from './fixtures';

// WCAG 2.1 A and AA on every main screen, as it first appears. Colour is never
// the only signal (CLAUDE.md), and a screen reader is the other way in.
const screens: { name: string; open: (page: import('@playwright/test').Page) => Promise<void> }[] = [
  { name: 'Today', open: (p) => openToday(p) },
  { name: 'Week', open: async (p) => { await p.goto('/week'); await expect(p.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible(); } },
  { name: 'Month', open: async (p) => { await p.goto('/month'); await expect(p.getByRole('heading', { name: 'October 2026' })).toBeVisible(); } },
  { name: 'Courses and syllabus', open: async (p) => { await p.goto('/plan'); await expect(p.getByRole('heading', { name: 'Courses and syllabus' })).toBeVisible(); } },
  { name: 'Settings', open: async (p) => { await p.goto('/settings'); await expect(p.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible(); } },
  { name: 'Search', open: async (p) => { await p.goto('/search'); await expect(p.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible(); } },
  { name: 'Sign in', open: async (p) => { await p.goto('/?signedout'); await expect(p.getByRole('heading', { name: 'Planner' })).toBeVisible(); } },
  { name: 'First run', open: async (p) => { await p.goto('/?firstrun'); await expect(p.getByText('Step 1 of 5')).toBeVisible(); } },
  {
    name: 'Editor',
    open: async (p) => {
      await openToday(p);
      await row(p, 'Read chapter 6 and annotate').click();
      await expect(p.getByRole('dialog', { name: 'Read chapter 6 and annotate' })).toBeVisible();
    },
  },
];

/**
 * Known failures, each tied to its bug in e2e/BUGS.md. test.fail() keeps
 * the suite green while they are open and turns red the moment one is fixed,
 * so the entry gets deleted rather than forgotten.
 */
const KNOWN: Record<string, string> = {
  'light Month': 'BUG-004: the month grid has buttons where rows and cells should be',
  'dark Month': 'BUG-003 and BUG-004',
  'dark Today': 'BUG-003: --text-low on raised surfaces is 4.14:1 in dark',
  'dark Week': 'BUG-003',
  'dark Search': 'BUG-003',
  'dark Editor': 'BUG-003',
  'dark First run': 'BUG-003',
};

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Accessibility, ${theme}`, () => {
    test.use({ colorScheme: theme });
    for (const s of screens) {
      test(`${s.name} has no WCAG A or AA violations`, async ({ page }) => {
        const known = KNOWN[`${theme} ${s.name}`];
        test.fail(!!known, known);
        await s.open(page);
        // Let entrance motion finish so contrast is measured on the settled screen.
        await page.waitForTimeout(600);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  });
}
