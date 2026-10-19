import { test, expect, openToday } from './fixtures';

// Every widget at every size it offers, in every theme: nothing may be cut by
// the widget's edge, and a list may show only whole rows. Found in Oct 2026
// by measuring, after "some of the widgets are cut off" — a fixed row count
// per size held in one theme and cut a row in half in another.
const SIZES: Record<string, string[]> = {
  due: ['peg', 'strip', 's', 'm'],
  work: ['s', 'tall', 'm', 'l'],
  now: ['s', 'm'],
  list: ['s', 'm'],
  class: ['strip', 's', 'm'],
  week: ['m', 'tall', 'l'],
  month: ['s', 'm', 'tall', 'l'],
  agenda: ['tall', 'l'],
  exams: ['s', 'm'],
  clock: ['peg', 'strip', 's', 'm', 'l'],
  clockday: ['m', 'tall', 'l'],
  count: ['peg', 'strip', 's', 'm'],
  focus: ['peg', 'strip', 's'],
  term: ['peg', 'strip', 's'],
  goal: ['peg', 's', 'm'],
  grades: ['s', 'm'],
  capture: ['strip', 's'],
  link: ['peg', 's'],
};
const ALL = Object.entries(SIZES).flatMap(([type, sizes]) => sizes.map((s) => `${type}:${s}`));
// The board holds at most 40, so the set is drawn in two halves.
const HALVES = [ALL.slice(0, 30), ALL.slice(30)];
const THEMES = ['cloisonne', 'letterpress', 'instrument', 'fjord', 'contrast', 'nothing', 'arc', 'cupertino', 'field', 'kraft'];

for (const theme of THEMES) {
  test(`every widget fits at every size in ${theme}`, async ({ page }) => {
    for (const half of HALVES) {
      await openToday(page, `?skin=${theme}&board=${half.join(',')}`);
      await expect(page.locator('.bw-w')).toHaveCount(half.length);
      await page.evaluate(() => document.fonts.ready);
      // Two frames for the row fitting in WidgetFrame to settle.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const problems = await page.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll<HTMLElement>('.bw-w').forEach((w) => {
          const inner = w.querySelector<HTMLElement>('.bw-in')!;
          const box = inner.getBoundingClientRect();
          const name = `${w.dataset.type} ${[...w.classList].find((c) => /^bw-(peg|strip|s|tall|m|l)$/.test(c))}`;
          inner.querySelectorAll<HTMLElement>('*').forEach((el) => {
            if (el.closest('svg') && el.tagName !== 'svg') return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
            if (!text && !['svg', 'BUTTON', 'LI'].includes(el.tagName)) return;
            const out = Math.max(box.top - r.top, r.bottom - box.bottom, box.left - r.left, r.right - box.right);
            if (out > 1) bad.push(`${name}: "${el.textContent?.trim().slice(0, 30)}" is ${Math.round(out)}px outside`);
            if (el.tagName === 'LI') {
              const list = el.parentElement!.getBoundingClientRect();
              if (r.bottom > list.bottom + 1 && r.top < list.bottom) bad.push(`${name}: half a row, "${el.textContent?.trim().slice(0, 30)}"`);
            }
          });
        });
        return [...new Set(bad)];
      });
      expect(problems).toEqual([]);
    }
  });
}
