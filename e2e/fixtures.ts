import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Wednesday 14 Oct 2026, 10:00 a.m. in Toronto. The sample account is dated
 * relative to the browser's today, so with the clock fixed here every run sees
 * the same week: WeBWorK due at 3 p.m. today, a lab report a day late, the
 * PHYS midterm on Friday.
 */
export const NOW = new Date('2026-10-14T14:00:00.000Z');

/**
 * Chrome reports a ResizeObserver callback that resizes what it observes as
 * an error, though the spec treats it as a deferred notification and nothing
 * is lost. It fires on sheets that grow as they open.
 */
const BENIGN = [/ResizeObserver loop completed with undelivered notifications/];

/**
 * Every test fails on a console error, an uncaught exception or a 5xx
 * response, whatever it set out to check. A screen can look right while
 * throwing underneath, and the error is usually the earlier warning.
 */
export const test = base.extend<{ clockAt: Date; allowErrors: RegExp | null; guard: void }>({
  clockAt: [NOW, { option: true }],
  /**
   * Console errors a test causes on purpose, such as a download it blocks.
   * One pattern, not a list: test.use() reads an array as [value, options].
   */
  allowErrors: [null, { option: true }],
  guard: [
    async ({ page, clockAt, allowErrors }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && ![...BENIGN, ...(allowErrors ? [allowErrors] : [])].some((r) => r.test(m.text()))) problems.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => {
        if (![...BENIGN, ...(allowErrors ? [allowErrors] : [])].some((r) => r.test(e.message))) problems.push(`uncaught: ${e.message}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 500) problems.push(`${r.status()} from ${r.url()}`);
      });
      await page.clock.setFixedTime(clockAt);
      await use();
      expect(problems, 'console errors, uncaught exceptions or 5xx responses').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The Today screen, loaded, with the sample in place. */
export async function openToday(page: Page, query = '') {
  await page.goto(`/${query}`);
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

/** Schedule (the screen at /week), loaded, with the sample in place. */
export async function openSchedule(page: Page, query = '') {
  await page.goto(`/week${query}`);
  await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
}

/**
 * Schedule by its tab, keeping the page: the sample account is in memory, so
 * a reload would forget anything the test has just written.
 */
export async function toSchedule(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Schedule/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
}

/** A row's own button, by the start of its accessible name. */
export const row = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) });

/** WCAG 2.1 A and AA violations on the page as it stands, one line each. */
export async function axeViolations(page: Page): Promise<string[]> {
  // axe types its Page against its own copy of playwright-core, which differs
  // from the runner's by a few newer methods; the object is the same at runtime.
  const result = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`,
  );
}
