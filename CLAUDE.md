# CLAUDE.md

Personal life planner. Single user, built for someone with ADHD and possible depression. Read this fully at the start of every session.

Full spec: `docs/spec.md` · Design tokens: `docs/design-system.md`

---

## The thing to understand first

The hard part of this project is not the features. It's that the app has to stay openable on a bad week. A technically correct planner that feels like a chore is a failed planner, and the failure is silent — it just stops getting opened one day and never gets opened again.

So when a tradeoff comes up between "more capable" and "less friction," take less friction. Every time.

---

## Non-negotiable rules

1. **Default view is Today.** Opening the app answers "what do I do right now" in under two seconds with no navigation.
2. **Minimum required fields at capture.** Every mandatory field is a chance for the thought to evaporate before it's recorded. If a field can be optional, it is.
3. **No streak-shaming.** No streak counters, no broken-streak states, no guilt copy, no "you missed 3 days." Missed days appear neutrally and are trivially back-fillable. This rule has been violated by well-meaning refactors before — check yourself against it whenever you add a history or stats view.
4. **No pure red in the UI.** Overdue is `--t-overdue` (clay rose). See the colour law below.
5. **Never silently lose data.** Optimistic UI is fine; a failed sync must be visible and recoverable.
6. **Never silently write.** AI-parsed food, AI-extracted syllabus dates, and chatbot actions are all shown for confirmation before they touch the database.
7. **Local time is `America/Toronto`.** A "day" is the user's local day, never UTC. Must survive DST.

## Copy voice

Plain, active, sentence case. Errors say what happened and what to do, and don't apologize. Empty states are neutral or an invitation — never a lament. No emoji. No exclamation marks.

**Praise is allowed, for a moment — never for a streak.** Warmth when something is finished is welcome: "that's everything for today" costs nothing and cannot be taken away. What stays banned is praise that accumulates into something losable — "5 days running", "best week yet", "don't break the chain" — because the moment it breaks it becomes the reason not to open the app. Acknowledge the day; never keep score across days.

---

## The colour law

Three systems want colour, and they are separated by temperature. Do not blur them.

- **Time / urgency** — warm earth ramp. Edge bars, text, icon tint.
- **Macros** — cool jewel tones. Ring strokes only.
- **Courses** — desaturated pastels. 3px left edge or 6px dot only, never a fill.

Macro colours never appear on a task. Urgency colours never appear on a ring.

**No colour value may be written anywhere except `tokens.css`.** No hex codes in components, no arbitrary Tailwind values like `bg-[#1D1F28]`. If a colour is needed that doesn't exist, propose adding it to the token file and say why — don't inline it. This single rule is what keeps a seven-phase build from looking like seven apps.

**Colour is never the only signal.** Every urgency state carries a text label; every ring carries a written value.

---

## Scope — do not add these

Full note-taking · gamification, points, levels, badges · workout tracking · personal finances.

If asked to add one mid-build, push back and say why before complying. Scope creep is the most likely cause of this project never shipping.

---

## Working agreement

- Build in phases, in order. Ship one phase working end-to-end before starting the next.
- Complete files. Never `// ... rest unchanged`.
- After each phase: what changed, what I need to do (accounts, keys, commands), **what is not yet working**, and the suggested next step.
- Prefer boring, well-understood dependencies. Every dependency is a thing that can break at 2am when the app is the only thing holding the week together.
- If something in the spec is ambiguous or looks wrong, say so before building it.
- Don't optimize prematurely. One user, a few thousand rows.

## Stack

React + Vite + TypeScript + Tailwind, PWA · Supabase (Postgres, auth, RLS, edge functions) · Cloudflare Pages or Vercel · scheduled edge function for the 07:00 digest · one swappable LLM module shared by the diet parser and the chatbot · USDA FoodData Central + Open Food Facts.

Free tiers only, permanently. If something can't be done free, say so rather than assuming a paid tier.

## Conventions

- Dates: store UTC timestamps, render in `America/Toronto`, compute "today" from local date.
- Money-like precision for macros: store grams as numeric, don't accumulate float error across a day.
- Changing a macro target must never retroactively alter historical days — targets are versioned by effective date.
- AI-estimated entries carry an `is_estimate` flag and render visually distinct from exact ones.
- Every table has RLS enabled. Data must not be publicly readable.

---

## Current status

Phase: **2 — digest and survival. DONE**, 18 Aug 2026. Phases 0 and 1 done 17-18 Aug.

Every Phase 2 item ships: configurable digest time and both windows, exam
escalation at T-1, per-item reminders, and low-battery mode.

**Low-battery mode is the one to preserve carefully.** It collapses the day to
what you marked non-negotiable plus ONE piece of work, chosen small-and-soon
rather than most-overdue — the most overdue item is the one avoided longest,
and offering it as today's only task on the worst day of the month is exactly
how the feature would backfire. Hidden work is counted, never named, never
marked skipped. Turning it off returns the day untouched: if using it cost
something later, it would not get used.

**Escalation and reminders both go quiet when they should.** An exam escalates
at 20:00 the night before, and only exams and presentations do, because if
everything escalates nothing does. A reminder about something already ticked is
never sent — verified live in both directions, with the dedupe record cleared
first so only the done-check could suppress it.

### Open, and none of it blocks Phase 3

- **The Web Push soak.** Web Push leads at priority 10, Telegram at 20 catches
  misses. Escalation and reminder tests both delivered via Web Push, which is
  encouraging but not the soak — that needs five clean 07:00 digests.
- **The free-tier pause.** Confirm around 24 Aug the project is awake.
- **Offline durability on real hardware**, still untested: capture something in
  airplane mode and reopen.

### Next: Phase 3 — diet tracker

The largest phase, and the first to need an outside dependency. Natural-language
food parsing behind one swappable LLM module, structured JSON validated before
it touches the database, a mandatory confirmation step, USDA and Open Food
Facts lookups preferred over model guesses, barcode scanning, saved meals, and
the four macro rings. The Ring component and the macro tokens have been waiting
since Phase 0.5.

Two things to settle before building it: which free-tier LLM, and that its
data-use policy is acceptable for food and medication data.

### A documented deviation from the colour law

The colour law says macro colours appear as **ring strokes only**. The weekly
trend chart uses `--m-calories` for the calorie bars and target band and
`--m-protein` for the weight line, which is not a ring stroke.

The reading taken: the law exists to stop the three systems blurring into each
other — urgency must not colour a ring, macros must not colour a task. A chart
of macros drawn in macro colours does not blur anything; it is the same system
in a second shape. Using urgency colours there would have been the actual
violation, and greyscale would have made two series indistinguishable.

Every value on that screen is also written out in the list below the chart, so
colour is not the only signal. Say if you want this narrowed to the letter of
the rule and the chart redrawn.

### Bugs found by verifying rather than assuming

Each of these was invisible in the UI and only surfaced by reading what
actually reached the database. Worth remembering as a working method.

- **Dose counter invented medication.** Deducting a floored amount but
  restoring the full amount meant a tap-and-untap at zero created a pill. The
  completion row now records what was taken and returns exactly that.
- **The outbox stranded writes.** A single-pass flush dropped anything queued
  while it ran — six rows imported, one written, five silent. It now drains
  until empty, and `await flush()` actually waits.
- **Replay order was not guaranteed.** Millisecond timestamps collide, so an
  edit could land before the insert that created its row. Timestamps are now
  strictly increasing.
- **A hung IndexedDB hung every write.** `open` can never settle; every tap
  then did nothing, silently. Now raced against a timeout, degrading to direct
  sends with the failure reported.
- **All-day events were stored at 23:59**, sharing the assignment rule. They
  now start at the beginning of their day, or T-1 reminders fire a day early.
- **Every secondary button in a form was a submit button.** Button set no
  `type`, and HTML defaults to submit inside a form, so "Delete" saved and
  "Remove from list" saved. Each did the opposite of its label, silently.
- **Duplicate courses were possible.** A double-tapped "Add course" made two,
  and every filter, dot and syllabus match then referred to whichever was
  found first. Six identical chips in the Week view is how it surfaced.
- **Chip had the submit-button bug too.** Fixing Button was not enough; the
  same hole existed in a second component and produced an undated task when
  "Tomorrow" was tapped. `tests/markup.test.ts` now fails the build if any
  `<button>` omits a type, and guards the colour law the same way. Fixing an
  instance is not fixing the class.
- **Verbatim text was rendered uppercase.** The captured wording is shown
  during triage so it is not lost, but `type-caption` uppercases — so the
  thing being preserved was being rewritten on screen. This then happened a
  second time, on the food log's `raw_text`, because the first fix swapped one
  class and left no correct home for small quoted text. There is now a
  `type-quote` utility: text the app did not author goes there, never in
  `type-caption`, which exists for machine labels like "ESTIMATED".
- **The history grid drew a month of completed days as blank**, because
  `loadToday` fetched five days of completions while the grid drew thirty-five.
  A query limit was manufacturing the exact wall rule 3 forbids.
- **Back-filling a past day spent a dose.** That pill left the bottle weeks
  ago and is already absent from the count, so recovering a rough week
  silently destroyed the number meant to protect you. Today spends; any other
  day only records.
- **A hardcoded model name retired underneath the app.** `gemini-2.5-flash`
  stopped being issued to new keys, and the 404 surfaced as "could not reach
  the model" — advice to retry, for a fault retrying cannot fix. The model is
  now `GEMINI_MODEL` with a current default, a 404 is classified as `retired`
  rather than `unavailable`, and the error lists the models the key can
  actually use so the next name is read rather than guessed.
- **Prose was rendered in the uppercase caption style, three times.** The
  captured wording on the triage screen, the raw text of a food entry, and
  then every input hint in the app at once, because `Field` put its hint slot
  in `type-caption`. The design system reserves that style for "urgency
  labels, metadata (uppercase)". The worst instance was the low-battery
  footer — "2 OTHER THINGS ARE HIDDEN. THEY KEEP." — on the one screen written
  for the worst day. There is now a `type-note` utility and a test that fails
  the build on a sentence in `type-caption`.
- **parse-food was never deployed.** `setup.mjs` deployed only `dispatch`, so
  the parser 404'd and the app said "couldn't reach the parser", which reads
  as a network problem rather than a missing function. Both functions are
  deployed by setup now.
- **A meal silently logged short.** PostgREST rejects a bulk insert whose
  objects have differing key sets (PGRST102, "All object keys must match"), so
  a meal where one item matched a barcode and carried `source_ref` and another
  did not failed as a whole — the entry was written, the items were not, and
  the day read 758 kcal instead of 1,244 with nothing on screen to say why.
  Row shaping is now one tested function, `itemRows`, that writes every key on
  every row including the nulls. Found by seeding a real day and noticing the
  ring did not match the arithmetic.
- **The service worker never registered**, for three days, with no error
  anywhere. `cache.addAll` is atomic, so one asset failing to cache killed the
  whole install; the worker never activated and `serviceWorker.ready` hung
  forever. Registered is not working, and a promise that never settles is far
  harder to find than one that rejects.

---

## Phase 0 — done, verified 17 Aug 2026

The gate is met. A scheduled server job delivered a real notification to the phone. Verified in production, not inferred:

- `cron.job_run_details` — the 15-minute job fires and succeeds.
- `net._http_response` — pg_net reaches the edge function, HTTP 200.
- The scheduled branch produced `sent: true` via Telegram with a real digest row (`"Mon, Aug 17" / "Nothing due."`), by temporarily moving the digest time to the current minute. Settings were restored and the forced row deleted afterwards.

117 tests, clean build, clean `deno check`. `npm run check` runs all three.

**Still open from Phase 0**, neither of which blocks Phase 1:

- **Not deployed.** `APP_URL` is still `http://localhost:5173`, so notification deep links are dead on the phone. Deployment is also a hard prerequisite for the Web Push soak — iOS only permits push for a PWA installed to the home screen over HTTPS.
- **The 7-day pause theory is untested.** Confirm around 24 Aug that the project is still awake.

Deliberate Phase 0 scope decisions, so they are not mistaken for gaps:

- **No feature tables.** Assignments, events, courses and the checklist are Phase 1. The digest builder correctly returns the empty digest ("Nothing due.") — which is a real specified code path, not a placeholder, and it is the branch hardest to notice being broken.
- **The offline outbox is the mechanism only**, exercised on one write type. Phase 1 routes its writes through it unchanged.
- **Web Push is written and unit-tested but unproven.** It is priority 20, below Telegram at 10. Promote it to 10 only after the 5-day soak; if it drops two days, leave Telegram primary and move on.

Three tokens deviate from `docs/design-system.md` to satisfy its own contrast floor. Each is documented inline in `tokens.css` with its measurement. Revert if you disagree.

Design system: **built** (Phase 0.5). Eight primitives, specimen page at `/?specimen` in dev.

_Update this section at the end of every phase._
