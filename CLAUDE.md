# CLAUDE.md

A student planner, built as a product for other people to use. Read this fully
at the start of every session.

**This was a single-user personal app until 19 Aug 2026 and the change is
permanent.** Anything still written as though there is one user, one timezone
or one set of targets is a leftover, not a decision — fix it rather than
matching it. The known ones are listed under "Carried over from the single-user
build" below.

What has NOT changed is what the app is for: getting academic work and daily
obligations in order with as little friction as possible. The design rules
below were written for one person and they survive the move, because low
friction and never scolding the user are good product principles, not personal
accommodations.

Full spec: `docs/spec.md` · Design tokens: `docs/design-system.md`

---

## The thing to understand first

The hard part of this project is not the features. It's that the app has to
stay openable in a bad week. A technically correct planner that feels like a
chore is a failed planner, and the failure is silent — it just stops getting
opened one day and never gets opened again. For a product, that failure has a
name: churn, and it happens before anyone writes a review explaining why.

So when a tradeoff comes up between "more capable" and "less friction," take
less friction. Every time.

Being a product adds a second rule of the same kind: **nothing may assume the
user is the person who built it.** No seeded personal data, no hardcoded
timezone, no target that is somebody's actual bulk. A new account opening the
app for the first time is now the most important screen in the build, and it
is the one with the least work in it.

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

Free tiers were the rule while this served one person, and they do not survive
contact with many. One shared Gemini key funds every user's food parsing and
every user's chat; Supabase's free row and bandwidth limits are a single pool.

Until there is a decision on this, treat the free tier as a hard constraint and
say plainly when a feature would breach it — but do not design as though it
scales, and do not quietly assume a paid tier either. Per-user cost is now a
design input, not an afterthought.

## Conventions

- Dates: store UTC timestamps, render in `America/Toronto`, compute "today" from local date.
- Money-like precision for macros: store grams as numeric, don't accumulate float error across a day.
- Changing a macro target must never retroactively alter historical days — targets are versioned by effective date.
- AI-estimated entries carry an `is_estimate` flag and render visually distinct from exact ones.
- Every table has RLS enabled. Data must not be publicly readable.

---

## Carried over from the single-user build

Found by audit on 19 Aug 2026, in the order they should be fixed. The schema
itself is already multi-user: RLS is `auth.uid() = user_id` on every table, a
trigger creates `app_settings` on signup, and the scheduler already iterates
every user. None of the below needs re-architecting.

1. ~~**Timezone is a module constant.**~~ DONE 19 Aug. The client wrapper
   supplies the account's zone as the default; the shared module still takes an
   explicit zone so the server stays per-request. `app_settings.timezone` is
   nullable now so "nobody has chosen" is representable, and the client detects
   and persists the browser's zone on first run.

   ORIGINAL: **Timezone is a module constant.** `_shared/time.ts` exports
   `TZ = 'America/Toronto'`, and every "today", every local-day key and every
   due-date render goes through it. `app_settings.timezone` already exists and
   the digest already reads it — the client does not. A user in Vancouver
   currently has their day computed three hours out, which silently moves what
   "due today" means. This is the deepest one and the most dangerous, because
   it is the confidently-wrong-deadline failure sitting at the foundation.
   `src/routes/Today.tsx` and `src/lib/month.ts` hardcode the zone separately.

2. ~~**There is no way to sign up.**~~ DONE 19 Aug. One screen with a mode
   rather than two pages. Email confirmation is on, so signup produces an email
   rather than a session, and the screen says so. Supabase does not reveal
   whether an address is registered — it returns an empty identities array —
   which is detected and reported honestly rather than stranding someone
   waiting for an email about an account they already have.

3. **The macro targets are one person's.** Migration 0010 seeded 2,900-3,100
   kcal and 160-175 g of protein at migration time. Verified 19 Aug that a new
   account correctly gets NONE, and the diet screen already handles that
   honestly. What is still undecided is whether it should stay absent until
   asked for, or be offered during a first run. Absent is the current
   behaviour and is defensible; it has simply not been chosen.

4. **Nothing onboards.** A fresh account has no courses, no checklist and no
   targets. Every screen has an honest empty state, which is not the same as
   a first run that goes somewhere.

5. **One Gemini key serves everyone.** `CHAT_CALLS_PER_DAY` is counted per
   user in `ai_usage`, but the quota underneath it is global — one heavy user
   can exhaust food parsing for all of them. See the stack note on free tiers.

6. **`setup.mjs` provisions a person, not an environment.** It creates the
   account and seeds that account's data. For a product it should set up the
   project and nothing else.

## Current status

Phase: **7 — extras. DONE**, 19 Aug 2026. All seven phases done 17-19 Aug.

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

### Phase 6 — intelligence. DONE, 19 Aug 2026

**"What now?" returns one task and says why.** A pick with no reason is
indistinguishable from a random one and gets treated as one. It asks only how
long you have, because a second question about energy on the screen built to
remove decisions would defeat the screen.

**Deferrals are rows, not a column.** The spec wants tasks flagged after six
moves, and `deferral_count` trips the structural guard that forbids `_count$`.
The guard was right and the design changed: missed days are already "the
absence of a row, never a number", and deferrals follow the same rule. It is
also more useful — six pushes over six months is a task you keep meaning to
get to, six in a week is one that is blocked, and only dated rows tell those
apart. The copy diagnoses rather than accuses, which is the spec's own reading.

**Actual time is never demanded.** After finishing something that carried an
estimate, a row of durations appears and can be ignored. Asking as a required
step would put friction on marking work done — the one action that has to stay
free — and a number given to dismiss a prompt is not worth calibrating on.
Calibration stays silent below five samples and uses the median, so one task
that ran five times over does not become the rule.

**The forecast counts unestimated work without inventing minutes for it.** A
total that silently assumed an hour each would be confident and partly built
on nothing; instead the known total is stated and the unestimated count sits
beside it.

The bug worth remembering: with a fifteen-minute budget, "what now" offered the
task that had been deferred seven times. Unestimated work was treated as
fitting any budget, and the unsized things are disproportionately the vague,
avoided ones — so the rule that was meant to avoid hiding work ended up
serving the single most avoided item. Stuck work is now held back unless it is
all that is left, and work known to fit is preferred over work of unknown size.

### Phase 7 — extras. DONE, 19 Aug 2026

Scoped to the organisational items on request: **no mood or energy check-in
and no doctor-appointment export.** This is a tool for keeping academic work
in order, and those two were the parts of Phase 7 that were not.

Low-battery mode and the no-streak rules stay exactly as they were. They are
friction reduction, not a wellbeing feature — they are what keeps the app
usable in a bad week, which is the academic case as much as any other.

**Global search** covers work, events, the inbox, courses and food from one
box. Ranked so a title that starts with what you typed beats one that merely
contains it, and open work beats finished — searching is nearly always a
prelude to acting rather than auditing. Grouped by kind, because the first
thing you know about what you are looking for is usually what sort of thing
it is.

**A subscribable .ics feed**, so deadlines appear in the calendar app that is
already on the lock screen. This is the only endpoint served without a login,
because a calendar client cannot present one, and the design follows from
that: the token is 32 random bytes, a wrong one and a missing one return the
same bare 404 so the endpoint is not an oracle, and only titles and times are
published — never notes. "Replace the link" is the revoke button.

RFC 5545 fails silently, so the tests are mostly about the format: a line over
75 octets, an unescaped comma, or LF instead of CRLF, and a client accepts the
feed and quietly drops events. Folding counts octets and never splits a
multi-byte character.

**Term archiving** hides a course from chips, filters and syllabus matching
without touching its work. Last term's record is the one thing a planner must
not quietly discard.

**A weekly review**, off unless asked for, on a chosen weekday at the digest's
own time. It names what was finished rather than counting it — "you finished
4 things" invites a comparison with last week, which is the first step to a
score. Nothing that did not happen is mentioned as a miss, and a quiet week
gets a neutral sentence.

Two things worth recording. Migration 0014 added `courses.archived_at` when
0003 had already added `courses.archived`, complete with a partial index and a
filter in the app's own query; 0015 drops the duplicate, because two columns
for one fact is how a fact ends up with two answers. And a seed script hit
PGRST102 again — one row with `completed_at`, two without — which is the same
class `itemRows` exists to prevent, arriving in a place with no guard.

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
- **"What now?" served the most avoided task.** With a fifteen-minute budget
  it offered the one deferred seven times, because unestimated work was
  treated as fitting any budget and unsized work is disproportionately the
  vague, avoided kind. A rule written to avoid hiding work ended up serving
  the single worst item. Stuck work is held back unless it is all that
  remains, and work known to fit now beats work of unknown size.
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
