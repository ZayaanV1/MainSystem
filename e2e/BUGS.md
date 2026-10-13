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
Status: fixed, 13 Oct. `src/lib/lazyRetry.tsx` replaces every `lazy()`
(20 of them). Each lazily loaded screen or sheet carries its own boundary for
download failures only; it shows "Couldn't load this" with Try again and, for
a sheet, Close; any other error is thrown on to the boundary above.

The retry had a second bug inside it, found by measuring rather than
assuming: Chromium remembers a module whose fetch failed, so importing the
same address again rejects at once without a request. Try again therefore
imports the failed file's address (read from the error) under a fresh
`?retry=N`. Safari does not name the file, so there it reloads while online
and keeps the bar while offline. The warm-up catches its own failures.
Tests: `e2e/resilience.spec.ts` (a sheet, Close, and a whole screen),
`src/lib/lazyRetry.test.ts` (each browser's wording).

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
Status: fixed, 13 Oct, with the owner's approval. The new palette-test pairs
(`--text-low` and `--text-mid` on `--ink-700`, all ten themes) found four
palettes short, not one: Cloisonné, Letterpress and Fjord dark, Fjord light
(4.28-4.34:1). Each `--text-low` moved the smallest step toward its
`--text-mid` that clears 4.6:1; Cloisonné dark went to #958778 so its glass
tab bar (#25221d) clears 4.5 too. Every copy of each theme was changed
(applied, previewed, and Fjord light's system-preference block). axe now runs
Today in all ten themes as well as nine screens in both modes, all clean.

### BUG-004: The month grid's buttons are not in rows and cells

- Severity: S3, accessibility (WCAG 1.3.1)
- Flow / case: Month
- Build: e409dbb · Chromium 141 · both themes

Expected: an element with `role="grid"` contains `row` elements, and those
contain `gridcell`s, so a screen reader can move by week and by day.
Actual: the day buttons are direct children of the grid. axe:
aria-required-children, critical.
Evidence: `e2e/a11y.spec.ts`, Month, light and dark (marked `test.fail`).
Status: fixed, 13 Oct. The month is now a labelled group, not a grid: a
grid promises arrow-key movement between cells, which it never had, and
each day button already says its weekday, date and count. Real grid
navigation would be a keyboard feature of its own.

## To check (not reproduced)

- The first run says "Three short steps" beside "Step 1 of 5" (the intro and
  the last screen count as steps). Possibly confusing; not a defect.
