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

Phase: **5 — chatbot. DONE**, 19 Aug 2026. Phases 0 to 4 done 17-19 Aug.

### Phase 2 — digest and survival. DONE, 18 Aug 2026

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

### Phase 3 — diet tracker. DONE, 19 Aug 2026

Every Phase 3 item ships except camera barcode scanning, which was a deliberate
call rather than an omission — see below.

Four ways in, one way out. Typed food goes to Gemini; a photo goes to the same
model; a barcode goes to Open Food Facts; an unbranded food goes to USDA
FoodData Central. All four land on the same editable confirmation screen, and
**nothing is written until it is confirmed**. Every path can be skipped
entirely: "Add by hand" is a visible button, not a sentence in an error.

**Provenance is recorded, not implied.** Every entry keeps its source and its
raw text, and every item keeps a `source_ref` — `off:` for a barcode, `fdc:`
for a USDA match. A model's low confidence arrives as an "Estimated" toggle
already set, which can be cleared once the chicken is actually weighed. The
point is that a month later you can still tell which numbers you chose, which
were read off a label, and which a model guessed.

**Saved meals keep the one-tap promise literally.** The portion selector
defaults to 1, so a tap logs a portion. It is sticky across chips and resets on
every visit, because a portion left at 2 from yesterday is a silent way to log
twice what you ate.

**Targets are versioned and the date is visible.** Changing today's protein
goal must not decide you were off target every day in July, and hiding the
effective date would make the mechanism invisible even though it works.
Verified live: raising protein today left 18 Aug still reading 160-175.

**The trend chart breaks its line across weeks with no weigh-ins.** A straight
segment across three unmeasured weeks draws a trend that was never observed.
Gaps read "not weighed", never zero, and no direction is graded.

### Open, carried into Phase 4

- **The Web Push soak.** Still wants five clean 07:00 digests.
- **The free-tier pause.** Confirm around 24 Aug the project is awake.
- **Offline durability on real hardware**, still untested: capture something in
  airplane mode and reopen. The browser used for verification can host neither
  IndexedDB nor a service worker, so this cannot be checked from here.
- **Camera barcode scanning was not built.** iOS Safari has no
  `BarcodeDetector`, and a decoding library is a large dependency for a path
  that already works — the digits are printed under the barcode and the packet
  is in your hand when you are logging it. Say if you want it for Android or a
  laptop webcam anyway.
- **Photo logging is verified through the API but not through the camera.** A
  real Gemini vision response came back correctly, low-confidence and all, from
  a generated image. The iOS file picker itself has never been exercised.

### Phase 4 — AI leverage. DONE, 19 Aug 2026

**Task breakdown.** One tap turns an assignment into four or five concrete
first moves. A model asked to do this returns "Research the topic, Write the
paper, Proofread" by default, which is the original paralysis in three pieces,
so the validator rejects that rather than trusting the prompt: vague verbs are
dropped, as is any step that is just the title again. Suggestions append and
never replace steps typed by hand.

**Syllabus import.** Dates are never calculated. "Week 6" and "TBD" come back
undated rather than counted forward from a term start the model does not know,
out-of-term dates are rejected as guessed years, and a malformed date discards
the date while keeping the deliverable — losing real work is the failure the
spec warns about, not a missing date. Dated exams become events, so they get
the T-1 escalation; everything undated becomes dateless work.

**Protein-gap suggestions use no model at all.** It is subtraction over data
already loaded, which costs nothing, needs no network, and keeps working when
the shared quota is gone — which is exactly when a tired person needs the
answer. It appears only when there is a gap and something that fits it, and
says nothing once the day is met: this answers a question, it does not prompt
eating.

That last one produced the session's best bug. Weighing protein shortfall
heavily and ignoring protein's ceiling looked right until it ran against a
real day and offered 1.5 portions to fill a calorie gap, pushing protein 26 g
past its band when one portion landed it squarely in range. The app enforces
the calorie ceiling, so ignoring the protein one was an inconsistency rather
than a decision. Overshoot now costs a third of what falling short does.

### Phase 5 — chatbot. DONE, 19 Aug 2026

**It answers only from a bounded slice of your own data.** Open work, a month
of events, today's checklist and food, saved meals, recent weigh-ins. Scoping
is a correctness feature before a privacy one: the model can only be
confidently wrong about data it was given, so everything left out becomes an
honest "I don't have that" instead of a guess. Verified — asked for a midterm
score it was never given, it said so rather than inventing one.

**Three mechanisms carry "never a confidently wrong deadline", none of them
the prompt.** The model must cite the ids it used; ids it was never given are
dropped as fabrications; and a proposed action naming an unknown id is refused
before it can reach a confirmation screen, where it would look exactly as
legitimate as a real one.

**Write actions are proposals.** Same confirmation step as parsed food and
extracted syllabus dates. A declined proposal stays in the transcript, because
deleting it would make the history read as though nothing was offered. Each
action runs through the same function the rest of the app uses, so a
chatbot-created assignment is identical to a hand-typed one.

**The shared quota has an explicit policy.** The chatbot and the diet parser
draw on one free tier, and they are not equally important: logging food is
something the app exists to do, asking it a question is a convenience. So chat
calls are counted per local day and the chatbot stands down at
`CHAT_CALLS_PER_DAY` (default 40) with a sentence saying the rest is kept for
food, rather than both hitting the wall together mid-meal. The budget is
self-imposed rather than derived from Google's published limits, which change,
are per-model and are not visible from here — a number inferred from them
would be a guess dressed as a policy. Hitting Google's real limit is still
handled as a quota failure.

That last one produced the phase's real bug, and it is the exact failure the
spec names. Asked when a lab was due, the first live answer was "2026-08-21 at
03:59" — the raw UTC timestamp, read out as though it were local. The real
deadline was Thursday 23:59. Every stored instant is UTC and slicing the ISO
string is the obvious thing to do and silently moves a deadline a day. The
context now converts through the same time layer as everything else, with
tests across a DST boundary and under four host timezones.

### Next: Phase 6 — intelligence

"What now?" as one button and one task; the workload forecast; estimated
versus actual time with calibration; and deferral surfacing. The last of these
needs a deferral count that nothing currently records, so it starts with a
migration rather than a screen.

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
- **The chatbot read UTC out as local time.** Asked when a lab was due it
  answered "2026-08-21 at 03:59", which is the raw stored instant; the real
  deadline was Thursday 23:59. Every timestamp in the database is UTC and
  slicing the ISO string is the obvious move, so the context claimed dates
  were local while handing over UTC. This is precisely the confidently wrong
  deadline the spec calls worse than no chatbot, and it passed a first live
  test looking entirely plausible. The context now converts through the same
  time layer as the rest of the app.
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
