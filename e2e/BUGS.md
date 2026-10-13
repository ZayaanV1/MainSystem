# Bugs found by the end-to-end suite

Found 13 Oct 2026 by the first run of `npm run e2e`, in the replica-test
format. Only what was reproduced is here. Severity: S1 data loss, security,
or core flow blocked; S2 a feature broken with no workaround; S3 broken with a
workaround, or visibly wrong; S4 cosmetic.

### BUG-001: Low-battery mode offered the most overdue task

- Severity: S2. The mode's one rule was broken, on the screen built for the worst day.
- Flow / case: low-battery mode, "If you have it in you"
- Build: e409dbb · Chromium 141, 390 px (iPhone 13 viewport)

Steps
1. Sample account, Wednesday 10 a.m. Open: a lab report a day late (2 h), WeBWorK due 3 p.m. today (45 min), a problem set due tonight (1 h 30).
2. Tap Low battery.

Expected: one task, small and soon, never the most overdue (CLAUDE.md,
Phase 2, and the comment on `chooseWork`). Here, WeBWorK.
Actual: the overdue lab report.
Evidence: `e2e/today.spec.ts` "low-battery mode keeps the essentials and one
task that is not the overdue one"; unit tests in `src/lib/lowbattery.test.ts`.
Suspected cause: `chooseWork` had no idea of "now". With no task of 30 minutes
or less, its fallback sorted by due date oldest first, which is the most
overdue item. Its own test for "avoided longest" passed only because that
sample included a 15-minute task.
Status: fixed. `chooseWork(assignments, now)` now prefers anything still
ahead (small first, then soonest) and offers overdue work only when nothing is
ahead, least overdue first. Three new unit tests, written failing first.

### BUG-002: One failed download of the editor blanks Today until a reload

- Severity: S3. Reload fixes it when online; offline, nothing does.
- Flow / case: opening a piece of work when its code cannot be fetched
- Build: e409dbb · Chromium 141, 390 px

Steps
1. Open Today with the editor's code unavailable (blocked in the test; in real
   life a cold offline start before the service worker has cached it, or the
   moment a new version activates and deletes the old cache).
2. Tap a piece of work.
3. Restore the network and tap it again.

Expected: the sheet fails on its own, Today stays usable, and the second tap works.
Actual: all of Today is replaced by "This screen couldn't be shown". React's
`lazy()` keeps the rejected import, so the editor stays broken for the rest
of the session, until Reload.
Evidence: `e2e/resilience.spec.ts` (marked `test.fail` until fixed).
Also: the idle warm-up in `src/routes/Today.tsx` calls `void load()` for six
sheets with no catch, so offline each one is an uncaught rejection.
Suggested fix, about an hour: a `lazy` wrapper that retries the import on the
next render instead of keeping the failure; the editor sheet in its own error
boundary so a failure costs the sheet, not Today; `.catch(() => {})` on the
warm-up.
Status: open. Proposed, not built.

### BUG-003: Low-emphasis text fails contrast on raised surfaces in dark mode

- Severity: S3, accessibility (WCAG 1.4.3)
- Flow / case: every screen with the tab bar, the checklist count, first-run hints
- Build: e409dbb · Chromium 141 · default theme, dark

Steps
1. Dark mode, default theme. Open Today.

Expected: all text at 4.5:1 or more.
Actual: `--text-low` (#8e8072) on the raised surface measures 4.14:1 on the
tab bar and the checklist pills (#25221d) and 4.29:1 on `--ink-700`
(#251e18). That covers the tab labels Week, Month, Search and More, "9 left",
and the first-run step hints.
Evidence: `e2e/a11y.spec.ts`, dark, on Today, Week, Month, Search, the editor
and the first run (marked `test.fail`).
Suspected cause: `tests/palette.test.ts` checks `--text-low` on the ground
(`--ink-900`) and the card surface (`--ink-800`), never on the raised surface
(`--ink-700`) that the tab bar and pills sit on.
Suggested fix: dark `--text-low` #8e8072 to #958778, the smallest step that
clears 4.5:1 on both (4.54 and 4.71), plus a palette-test pair for
`--text-low` on `--ink-700` across all ten themes. That test will report any
other theme with the same gap.
Status: open. Proposed, not built (a token change, so it is yours to approve).

### BUG-004: The month grid's buttons are not in rows and cells

- Severity: S3, accessibility (WCAG 1.3.1)
- Flow / case: Month
- Build: e409dbb · Chromium 141 · both themes

Expected: an element with `role="grid"` contains `row` elements, and those
contain `gridcell`s, so a screen reader can move by week and by day.
Actual: the day buttons are direct children of the grid. axe:
aria-required-children, critical.
Evidence: `e2e/a11y.spec.ts`, Month, light and dark (marked `test.fail`).
Suggested fix: wrap each week in `role="row"` and each day in
`role="gridcell"`, or drop `role="grid"` and keep the buttons as a plain
labelled group, since arrow-key grid navigation is not implemented anyway.
Status: open. Proposed, not built.

## To check (not reproduced)

- The first run says "Three short steps" beside "Step 1 of 5" (the intro and
  the last screen count as steps). Possibly confusing; not a defect.
