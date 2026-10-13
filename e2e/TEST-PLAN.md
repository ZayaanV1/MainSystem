# End-to-end test plan

The real app in a real browser, on the in-memory sample account in
`e2e/harness`. Written 13 Oct 2026 with the replica-test method: every flow
gets a happy path, the edge cases that apply, and negative cases where there
are any.

```bash
npm run e2e          # phone (iPhone 13), iPad and desktop, about 35 s
npm run e2e:phone    # phone only
npx vite --config e2e/harness/vite.config.ts   # look at the sample yourself, :5199
```

The first run needs a browser: `npx playwright install chromium`.

**What every test checks without being told:** no console error, no uncaught
exception, no 5xx response (`e2e/fixtures.ts`). The clock is fixed at
Wednesday 14 Oct 2026, 10 a.m. Toronto, so the sample's "due at 3 p.m. today"
is the same at any hour the suite runs.

**What it cannot check:** push notifications, the service worker's real
caching, email, iOS Safari itself (Chromium stands in, at phone size), and
anything that needs the real Supabase. The harness swaps the database for
memory, so a full page reload resets the sample: navigate with the tab bar
inside a test, never with `page.goto`, or the check proves nothing.

| case | flow | type | expected | spec | result |
| --- | --- | --- | --- | --- | --- |
| F01-H1 | Open the app | happy | Today first, sorted into Late, Today, Tomorrow, This week, No date | today | pass |
| F02-H1 | Capture | happy | "lab report thu 5pm phys" is read as Thu 5 p.m., PHYS 205, shown before saving | today | pass |
| F02-E1 | Capture | edge: no date | goes to the inbox | today | pass |
| F02-E2 | Capture | edge: double submit | one item, not two | today | pass |
| F02-E3 | Capture | edge: offline | shows at once, still there online | account | pass |
| F03-H1 | Finish work | happy | moves out, Undo puts it back, actual time offered never demanded | today | pass |
| F03-H2 | What now | happy | one task, with a reason | today | pass |
| F03-E1 | Low battery | edge: nothing small | essentials plus one task, not the overdue one; hidden work counted not named | today | pass (was BUG-001) |
| F04-H1 | Edit work | happy | a quick due chip moves it | today | pass |
| F04-N1 | Delete work | negative | one tap does not delete; two do | today | pass |
| F04-E1 | Edit work | edge: reload | the link to the work reopens it | today | pass |
| F04-E2 | Edit work | edge: its code fails to load | Today stays usable, Try again opens it, Close dismisses | resilience | pass (was BUG-002) |
| F04-E3 | Any screen | edge: its code fails to load | the tab bar stays, Try again loads it | resilience | pass |
| F05-H1 | Syllabus | happy | read, shown for checking, then added | plan | pass |
| F05-N1 | Syllabus | negative: not confirmed | nothing on Week (rule 6) | plan | pass |
| F06-H1 | Typed deadlines | happy | previewed, flags an assumed year | plan | pass |
| F07-N1 | Repeating work | negative: no day | cannot add; says why | plan | pass |
| F07-H1 | Grades | happy | banked and outstanding, "not a prediction" | plan | pass |
| F08-H1 | Sign in | happy | sign in, new account, forgotten password | account | pass |
| F08-E1 | Sign in | edge | the password can be shown | account | pass |
| F09-H1 | First run | happy: skip all | ends on Today | account | pass |
| F10-H1 | Export | happy | a JSON file with the work and the courses | account | pass |
| F12-H1 | Week | happy | seven days, hours per day, the exam on its day | week | pass |
| F12-E1 | Week | edge: one course | others hidden | week | pass |
| F12-H2 | Week | happy: bulk | two selected | week | pass |
| F12-H3 | Month | happy | counts per day | week | pass |
| F13-H1 | Search | happy | finds work from "webw" | week | pass |
| T-E1 | Time | edge: phone in Vancouver | the account's zone is shown (5 p.m., not 2 p.m.) | time | pass |
| T-E2 | Time | edge: DST ends Sunday | a deadline after it keeps 5 p.m.; the week has seven days | time | pass |
| T-E3 | Time | edge: 11:58 p.m. | still Wednesday, though Thursday in UTC | time | pass |
| D-H1 | Command palette (desktop) | happy | Cmd/Ctrl+K, "week", Enter | keyboard.desktop | pass |
| D-H2 | Drag to reschedule (desktop) | happy | dragged to Saturday, Undo restores Thursday | keyboard.desktop | pass |
| A-1 | Accessibility | WCAG 2.1 AA, 9 screens, light and dark | no violations | a11y | pass (was BUG-003, BUG-004) |
| A-2 | Accessibility | Today in all five themes, light and dark | no violations | a11y | pass |
| P-1 | iPad upright | no screen scrolls sideways | seven screens, none wider than the screen | ipad.tablet | pass (Courses was 20 px wider while sliding in) |
| P-2 | iPad upright | the tab bar | all seven destinations, no More, at most 640 px and centred | ipad.tablet | pass |
| P-3 | iPad upright | Today | What now and the inbox beside the work, on the first screen | ipad.tablet | pass |
| P-4 | iPad upright | chip rows | every checklist pill and course chip fully on screen | ipad.tablet | pass |
| P-5 | iPad upright | a sheet | a centred column at most 640 px | ipad.tablet | pass |
| P-6 | iPad upright | edge: turned with More open | no scrim left over the page | ipad.tablet | pass |
| P-7 | iPad upright | accessibility | Today and Week, no violations | ipad.tablet | pass |
| P-8 | iPad on its side | the rail | replaces the tab bar; no screen scrolls sideways | ipad.tablet | pass |
| P-9 | iPad on its side | touch | the tap floor stays 44 px without a mouse | ipad.tablet | pass |
| P-10 | iPad on its side | the editor | docks full height on the right | ipad.tablet | pass (stopped at 90% of the height) |
| P-11 | iPad on its side | accessibility | Today, no violations | ipad.tablet | pass |

**Totals, 13 Oct:** 73 tests, all green, 11 of them on an iPad. The first run found one S2 and three
S3 bugs (e2e/BUGS.md); all four are fixed. A bug that is found but not yet
fixed gets a `test.fail` against its id: green while the bug is open, red the
day it is fixed, so the mark is removed rather than forgotten.

The iPad project is Chromium told it is an iPad (touch, no hover, iPad
size); WebKit is not installed, so Safari's own rendering is not covered.

Not yet automated: long-press drag on a real touch screen, the syllabus photo
and PDF paths, notifications, and the Abood chat (it needs the model).
