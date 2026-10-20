import { test, expect, openSchedule, openToday, row, axeViolations } from './fixtures';

// WCAG 2.1 A and AA on every main screen, as it first appears. Colour is never
// the only signal (CLAUDE.md), and a screen reader is the other way in.
const screens: { name: string; open: (page: import('@playwright/test').Page) => Promise<void> }[] = [
  { name: 'Today', open: (p) => openToday(p) },
  { name: 'Schedule', open: (p) => openSchedule(p) },
  { name: 'Month', open: async (p) => { await p.goto('/month'); await expect(p.getByRole('heading', { name: 'October 2026' })).toBeVisible(); } },
  { name: 'Courses and syllabus', open: async (p) => { await p.goto('/plan'); await expect(p.getByRole('heading', { name: 'Courses and syllabus' })).toBeVisible(); } },
  { name: 'Settings', open: async (p) => { await p.goto('/settings'); await expect(p.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible(); } },
  { name: 'Search', open: async (p) => { await p.goto('/search'); await expect(p.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible(); } },
  { name: 'Sign in', open: async (p) => { await p.goto('/?signedout'); await expect(p.getByRole('heading', { name: 'Planner' })).toBeVisible(); } },
  { name: 'First run', open: async (p) => { await p.goto('/?firstrun'); await expect(p.getByText('Step 1 of 5')).toBeVisible(); } },
  {
    name: 'Editor',
    open: async (p) => {
      await openSchedule(p);
      await row(p, 'Read chapter 6 and annotate').click();
      await expect(p.getByRole('dialog', { name: 'Read chapter 6 and annotate' })).toBeVisible();
    },
  },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Accessibility, ${theme}`, () => {
    test.use({ colorScheme: theme });
    for (const s of screens) {
      test(`${s.name} has no WCAG A or AA violations`, async ({ page }) => {
        await s.open(page);
        // Let entrance motion finish so contrast is measured on the settled screen.
        await page.waitForTimeout(600);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  });
}

// Every theme, in both modes. The palette test checks token pairs; the tab
// bar is glass, composited over the page, so only the rendered screen shows
// the contrast its labels really get (BUG-003 was 4.14:1 there, 4.29:1 on the
// token alone).
for (const skin of ['cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`Theme ${skin}, ${theme}`, () => {
      test.use({ colorScheme: theme });
      test('Today has no WCAG A or AA violations', async ({ page }) => {
        await openToday(page, `?skin=${skin}`);
        await page.waitForTimeout(600);
        expect(await axeViolations(page)).toEqual([]);
      });
    });
  }
}
