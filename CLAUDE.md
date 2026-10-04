# CLAUDE.md

A student planner, built as a product for other people to use. Read this fully
at the start of every session.

**This was a single-user personal app until 19 Aug 2026 and the change is
permanent.** Anything still written as though there is one user, one timezone
or one set of targets is a leftover, not a decision — fix it rather than
matching it. The known ones are listed under "Carried over from the single-user
build" below.

**Built for one, architected for many.** Decided 19 Aug 2026. Today there is
one real user and production concerns — deliverable email, billing, support,
abuse handling — are explicitly out of scope. What is NOT deferred is the
shape of things: no assumption that there is one user may enter the code, the
schema or the scripts, because the point of deferring the operations work is
that it can be picked up later without a rewrite.

The practical test for any new work: if a second account signed up tomorrow,
would this be wrong? If yes, it is wrong now. If it would merely be
unpolished, that is fine and it can wait.

What has NOT changed is what the app is for: getting academic work and daily
obligations in order, and making a student who has Notion, Todoist, Google
Calendar and MyStudyLife choose this instead. Never scolding the user survives
the move to a product because it is a good product principle, not a personal
accommodation.

Full spec: `docs/spec.md` (the original brief, kept as history) · Design
tokens: `docs/design-system.md` · Current brief: the workhorse upgrade, Oct 2026.

---

## The thing to understand first

A technically correct planner that feels like a chore is a failed planner, and
the failure is silent — it stops getting opened one day and never gets opened
again. For a product that failure has a name, churn, and it happens before
anyone writes a review explaining why.

The answer is not a thinner app. **Depth arrives through progressive
disclosure; the default path never gains a required step.** That is the only
friction test: what the common action costs, not how much the app can do. A
power feature one tap away costs the person who never taps it nothing. A
required step on the way to ticking something off costs everyone, every day.

Formerly: "when a tradeoff comes up between 'more capable' and 'less
friction,' take less friction. Every time." Changed 3 Oct 2026, on the
owner's instruction to adjust the rules holding the work back. In practice that
sentence worked as a veto on capability — and it was argued from a user's mood
or a bad week, which rule 11 now forbids. The insight it protected is kept,
and stated as the test above.

Being a product adds a second rule of the same kind: **nothing may assume the
user is the person who built it.** No seeded personal data, no hardcoded
timezone, no target that is somebody's actual bulk. A new account opening the
app for the first time is the most important screen in the build.

---

## Non-negotiable rules

1. **Default view is Today.** Opening the app answers "what do I do right now" in under two seconds with no navigation.
2. **Minimum required fields at capture.** Every mandatory field is a chance for the thought to evaporate before it's recorded. If a field can be optional, it is.
3. **Streaks are an optional module, off until the user turns it on.** Nobody who has not switched it on ever sees a streak, a count, or any copy about one. When on: computed from completion rows, never stored as a counter; missed days still appear neutrally and back-filling still counts; no broken-streak guilt copy, ever. Points, levels and badges stay out of scope. Formerly a blanket ban ("No streak-shaming"); changed by the owner's Oct 2026 brief. The ban's reasoning still governs everyone who has not opted in, and history views are still where this rule gets broken — check yourself there.
4. **No pure red in the UI.** Overdue is `--t-overdue`. See the colour law below.
5. **Never silently lose data.** Optimistic UI is fine; a failed sync must be visible and recoverable.
6. **Never silently write.** AI-extracted syllabus dates, task breakdowns and chatbot actions are all shown for confirmation before they touch the database.
7. **Time is the account's own zone.** A "day" is the user's local day in `app_settings.timezone`, never UTC and never a hardcoded city. Must survive DST. Server-side time functions take a zone with no default, so a call without one fails to compile (Oct 2026). Formerly "Local time is `America/Toronto`", from the single-user build.
8. **Built for one, architected for many.** If a second account signing up tomorrow would make it wrong, it is wrong now. RLS on every table, `auth.uid() = user_id`, and no definer function that takes a user id from its caller.
9. **Build the ambitious version.** Never scale a feature or a design back with reasoning about the user's mood, energy or "a bad week". Argue against something only on engineering or design merit — cost, performance, a real collision with another part of the system. `prefers-reduced-motion` stays supported, as an operating-system accessibility setting.
10. **Abood is a companion, not a director.** When the user opens up, Abood does not steer to assignments. It talks like a close friend with a good therapist's instincts, never textbook reflective listening. `scripted()` in `_shared/chat.ts` and `modeFor()` in `_shared/abood.ts` enforce this mechanically; do not weaken either.
11. **No inert or redundant features.** Everything added is reachable from a real screen and verified to do what it says. `tests/reachable.test.ts` fails the build on a component nothing renders, a table nothing reads, and an export nothing but a test calls.
12. **Every tap that changes something is animated, noticeably.** If a tap or press makes an entity disappear, appear, move, reorder or change in any way — a finished task leaving the list, a tick, a count, a sheet, a toggle — that change has a proper animation the user can see. No cut, ever, and no exceptions for "small" changes. Under Reduce Motion the travel is removed and the change is shown as a fade or colour change, never an instant swap. Set by the owner, 3 Oct 2026, after ticking off work on Today made the row vanish with no animation at all: the optimistic layer drops it from the open list in the same render and React unmounts it.
13. **Nothing visual is destroyed; it becomes an option.** Any animation, material or visual treatment that is removed, toned down or replaced stays available as a setting the user can turn back on — including the expensive ones, such as real backdrop-blur glass on every surface or an animated blur. Performance is an argument for a default, never for deletion. Set by the owner, 4 Oct 2026.

## Copy voice

Plain, active, sentence case. Errors say what happened and what to do, and don't apologize. Empty states are neutral or an invitation — never a lament. No emoji. No exclamation marks — kept deliberately when the rules were revisited in Oct 2026: a calm, confident voice is part of what makes the app read as a finished product rather than an eager one.

**Praise is allowed, for a moment.** Warmth when something is finished is welcome: "that's everything for today" costs nothing and cannot be taken away. Praise that accumulates into something losable — "5 days running", "best week yet" — appears only inside the streaks module, only for someone who turned it on, and even there a break is stated neutrally and never as a loss ("Started again today", never "You lost your streak").

---

## The colour law

The systems that carry meaning are separated by **role** first and hue second. Do not blur them.

- **Time / urgency** — one ramp that gains intensity as a deadline closes. Text, numerals, edge bars and icon tint; never a fill. The shipped ramp is rose (`tokens.css`); the original brief said "warm earth", and which one each theme uses is decided by eye, live, in the design-system work — not by reading hex values.
- **Courses** — desaturated pastels. Marks (a 3px edge, a 6px dot, a ring) and translucent washes on a course's own surfaces — slips, tiles, calendar blocks — never an opaque fill, and always under text that keeps its contrast.
- **Brand** — each theme's own pair (the first is phthalo and burnt orange). Filled surfaces and atmosphere only; never a status.

**Every theme obeys the same roles with its own values.** All values live in `tokens.css` as token sets per theme and mode; a theme re-tunes the urgency ramp and the course pastels so they stay distinguishable and readable on its own surfaces, and `tests/palette.test.ts` fails the build if any text or urgency pairing drops below WCAG 2.1 AA in any theme or mode.

**No colour value may be written anywhere except `tokens.css`.** No hex codes in components, no arbitrary Tailwind colours, and no `/NN` opacity modifier on a colour utility (it compiles to color-mix, whose opaque fallback broke iOS 16.0-16.1). Translucency is a token with a real alpha. If a colour is needed that doesn't exist, add it to the token file and say why.

**Colour is never the only signal.** Every urgency state carries a text label; every mark that encodes something has words beside it.

Formerly "two systems, separated by temperature: urgency a warm earth ramp, courses a 3px edge or 6px dot only". Restated Oct 2026 for themes, and to describe what had actually shipped: the ramp was already rose and course washes had already been allowed on calendar blocks.

---

## Scope — do not add these

Points, levels, badges · workout tracking · personal finances · food, macro or bodyweight tracking (built in Phase 3, removed Oct 2026) · a general-purpose notes app.

Streaks are no longer on this list; they are an opt-in module (rule 3). Notes tied to academic work — working notes on an assignment, a course page holding the syllabus, links and grade breakdown — are a product question being put to the owner, not an exclusion. If asked to add something on this list mid-build, push back and say why before complying.

---

## Working agreement

- **Propose, then build.** Investigate freely — read, run, measure, query read-only, prototype. Change nothing in the repo, the database, deployed functions or settings until the owner has approved that specific change. Visual work is proposed as a live prototype the owner can open on a phone, with alternatives to switch between. Approved work is then built, pushed to `main`, deployed (edge functions and migrations included) and verified on the live URL without asking again. Destructive steps get their own explicit yes even inside an approved batch.
- **Challenge rules openly.** Nothing in this file is beyond challenge. Name the rule, what it costs, the evidence, and a replacement worded to go straight in here. Never break or route around a rule quietly; until the owner changes it, follow it.
- Complete files. Never `// ... rest unchanged`.
- After each piece of work: what changed, what the owner needs to do, **what is still not working or unverified**, and the suggested next step.
- **Performance has a budget**, because the app must run at the display's native rate: 8.3 ms per animated frame at 120Hz (6.9 ms at 144Hz), with a solid 60fps floor on mid-range phones; eager JavaScript at or under 150 KB gzip (197 KB as of 3 Oct 2026 — to be met); every list query bounded. Measure with traces at the real refresh rate rather than describing anything as smooth. Formerly "Don't optimize prematurely. One user, a few thousand rows" — changed Oct 2026; the unbounded 350-row event query was that sentence in practice.
- Prefer boring, well-understood dependencies, and one of each kind. **No animation library**: the platform is the engine. `lib/motion.ts` hands the browser keyframes through the Web Animations API, so motion keeps its shape while a screen renders and Safari does not hold it to 60fps. Formerly "one animation engine, not two" — the app shipped two (Motion, about 41 KB gzip, and anime.js, about 16 KB), both driving frames from JavaScript; removed Oct 2026, taking eager JavaScript from 203 KB to about 158 KB.
- If something in the spec is ambiguous or looks wrong, say so before building it.

## Motion and design

The app has to look, move and feel like a product from Google or Apple. That is the point of the work, not polish saved for the end.

- **Compositor only.** Animate `transform` and `opacity`. Never animate layout (height, grid tracks, top/left) or paint-heavy properties every frame.
- **Native refresh rate.** Never assume 60fps: JavaScript animation is driven off frame timestamps, never a fixed per-frame step, so it runs at the right speed at 60, 120 or 144Hz. No layout, paint or main-thread work inside an animated frame.
- **A named motion system**, applied everywhere: a small set of physically plausible springs and easings with names, settling without overshoot on a press. Animations are interruptible — a tap mid-transition never stalls. Gestures follow the finger 1:1 and settle with momentum. Entrances are staged and exits are as considered as entrances (formerly "leaving is a cut"). Shared-element transitions carry an item from list to detail; the View Transitions API is used where it helps.
- **Touch first.** Hover transforms only behind `(hover: hover) and (pointer: fine)`. Presses scale in place, respond instantly, and never lift then dip or shift layout.
- **Light and dark are designed as a pair** for every theme. Dark is never an inverted light, and light is never a derived dark (formerly "dark is primary; light is derived" in design-system.md). Follow-the-system switches live.
- **The approved language** — cloisonné glass with lit rims and glow, the Edmondson ticket, the Swiss timetable, display-scale tabular numerals, information encoded in shape — is the starting point, and may be pushed further. Flat, default-looking surfaces are the failure mode.
- `prefers-reduced-motion` is honoured everywhere: travel is removed and every change is shown as a fade or colour change instead (rule 12). Formerly "motion collapses to instant state changes" — a global rule in `index.css` shortened every transition and animation to 0.01ms, so on a phone with Reduce Motion on, nothing in the app animated at all. `tests/motion.test.ts` fails the build if a reduced-motion block shortens a duration to nothing.

Formerly, design-system.md's direction "Instrument": restrained motion, no looping or ambient animation, no skeleton shimmer, and glass rationed to one control per screen. Superseded Oct 2026 — it capped the app below the standard it is now held to.

## Stack

React + Vite + TypeScript + Tailwind, PWA · Supabase (Postgres, auth, RLS, edge functions) · Vercel · scheduled edge functions for the digest, feeds and check-ins · one swappable LLM module (Groq first, Gemini fallback) shared by the syllabus reader, task breakdown, briefing and chatbot.

Free tiers were the rule while this served one person, and they do not survive
contact with many. One shared key funds every user's model calls unless an
account brings its own; Supabase's free row and bandwidth limits are a single pool.

Until there is a decision on this, treat the free tier as a hard constraint and
say plainly when a feature would breach it — but do not design as though it
scales, and do not quietly assume a paid tier either. Per-user cost is a
design input, not an afterthought.

## Conventions

- Dates: store UTC timestamps, render in the account's zone, compute "today" from the local date. (Was `America/Toronto` until the app became multi-user.)
- **Every screen and every open item has a URL.** Navigation goes through history so the back gesture works everywhere, notifications and the share sheet can open a specific thing, and a list-to-detail transition has two real ends. Hand-rolled, no router dependency. Adopted Oct 2026; the app still routes by component state until this is built (`App.tsx`).
- **Grade tools compute exactly what is asked and show the arithmetic.** "What do I need on the final", what-if scenarios — never a colour for a good or bad mark, never a verdict. Formerly "no projection, no running average, no verdict", which blocked the tools themselves.
- **Nothing important is hidden by default; the user may hide what they choose.** Customisation never deletes data — turning a module off hides it, turning it on restores everything. (The original brief said "nothing important is hidden behind a tap", which would have forbidden a Today the user arranges.)
- Exact precision for anything summed (grade weights): store as numeric, don't accumulate float error.
- Every table has RLS enabled. Data must not be publicly readable.
- Every list query is bounded; PostgREST caps a response at 1,000 rows and truncates silently past it.

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

3. ~~**The macro targets are one person's.**~~ MOOT, Oct 2026: the diet
   tracker and its tables were removed. ORIGINAL: Migration 0010 seeded 2,900-3,100
   kcal and 160-175 g of protein at migration time. Verified 19 Aug that a new
   account correctly gets NONE, and the diet screen already handles that
   honestly. What is still undecided is whether it should stay absent until
   asked for, or be offered during a first run. Absent is the current
   behaviour and is defensible; it has simply not been chosen.

4. ~~**Nothing onboards.**~~ DONE 19 Aug. Four steps, every one skippable:
   courses, a pasted syllabus, the daily checklist, done. It asks nothing the
   app could answer itself — no timezone, no name — and nothing is
   pre-selected, because a checklist you start by deleting from is worse than
   an empty one. `onboarded_at` is set on finish OR skip, and 0021 backfills
   accounts that already hold data, since they are not new whatever the flag
   says.

5. ~~**One Gemini key serves everyone.**~~ DONE 19 Aug. An account can supply
   its own key in Settings, which decouples it from the shared tier entirely;
   the daily question budget stops applying to anyone using one, since that
   reserve exists to protect a shared pool. The field is write-only — the app
   asks whether a key is set and never reads one back. The shared key is still
   the default, and it hit Google's daily limit during a single day of
   development, which is the clearest possible argument for the option.

6. ~~**`setup.mjs` provisions a person, not an environment.**~~ DONE 19 Aug.
   Steps 1-5 and 9 set up a project; 6-8 and 10 provision a person and now run
   only when `.env.setup` names one. Removing `APP_EMAIL`, `APP_PASSWORD` and
   `TELEGRAM_BOT_TOKEN` from that file is the entire difference between a
   personal install and a shared one — no code changes, since sign-up and
   per-account notification settings already exist.

### Audited 19 Aug and found clean

Recorded so it is not re-derived. Every edge function runs as the service
role, which bypasses RLS, so a query missing a user filter would cross
accounts silently — all four were checked and the only unscoped one is the
scheduler deliberately iterating every user. The single service-role write
carries a user id from the verified JWT, and `deliver.ts` updates only rows it
already fetched scoped by user. All twenty foreign keys to `auth.users`
cascade on delete, so removing an account removes its data. No hardcoded user
ids anywhere in `src/` or the functions.

## Current status

Phase: **the workhorse upgrade.** Phase A (audit and fixes) DONE 3 Oct 2026 —
see "Phase A — audit and fixes" below. Phase B (the design system, raised to
top-tier) is next. The original seven build phases were done 17-19 Aug 2026.

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

### Phase 3 — diet tracker. DONE, 19 Aug 2026. REMOVED, Oct 2026 — see below

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

- ~~**The Web Push soak.**~~ PASSED, 8 Sep 2026. Digests arrive daily on the
  phone. Web Push is now priority 10 and Telegram 20 in the live account, and
  `setup.mjs` creates Telegram at 20 so a fresh install matches.

  This is a bigger deal than a channel reordering. Telegram needs a bot token
  per person, which a second account will never have — so until the soak
  passed, notifications did not really exist for anyone but the developer, and
  the whole digest feature was single-user in practice while claiming not to
  be. It is now the one delivery path that works for a stranger.
- ~~**The free-tier pause.**~~ NOT REAL. The project has been continuously
  awake through 8 Sep with no intervention, well past the 24 Aug check and the
  seven-day theory that prompted it. Verified incidentally: edge functions
  deployed and migrations applied on demand weeks later.
- **Offline durability on real hardware**, still untested: capture something in
  airplane mode and reopen. The browser used for verification can host neither
  IndexedDB nor a service worker, so this cannot be checked from here.
- ~~**Camera barcode scanning was not built.**~~ BUILT 19 Aug, on request.
  Two decoders chosen at runtime: `BarcodeDetector` where it exists, which
  costs nothing, and a 464 KB gzipped WebAssembly build of ZXing everywhere
  else — iOS Safari still had no `BarcodeDetector` in August 2026. The WASM is
  dynamically imported so nothing downloads until Scan is tapped, and it is
  served from our own origin rather than the library's default CDN, which
  would have put a third-party round trip in the middle of scanning a packet
  in a shop. Typing the digits stays available throughout.
- ~~**Photo logging is verified through the API but not through the camera.**~~
  MOOT, Oct 2026: removed with the diet tracker.

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

### Post-launch hardening — Sep 2026

An outside-eyes review on 7 Sep, run against the rule "verify, do not trust
this document". It found things this file confidently marked DONE.

**Three defects that were actively lying to the user.**

- **The chatbot told everyone Toronto's time and called it theirs.**
  `_shared/context.ts` carried a long comment about the UTC-read-as-local bug
  and then called `localDayKey(instant)` with no zone, falling back to the
  module constant item 1 above claims was removed. `assist/index.ts` had a
  hardcoded `'America/Toronto'` literal as well. Meanwhile `buildContext`'s
  second line tells the model "All dates below are already in the user's local
  time". Fourteen hours wrong in Sydney, which crosses the day boundary. The
  zone now comes from `app_settings`; `ContextInput.timezone` is required with
  no default, because a default is what caused it.
- **A failed read looked like a clear day.** Ten queries in `loadToday`, every
  one ending `data ?? []`, `.error` read on none. Worse: `!data?.assignments
  .length` is also true while loading, so Today rendered "Nothing due." on
  EVERY open before any error was involved. Loading, failed, empty and full are
  four distinguishable states now.
- **The AI budget protected nothing.** One of five model paths metered. Chat
  stood down at 40 saying the rest was "kept for food" while food parsing had
  no guard at all. All five metered through `_shared/budget.ts`.

**Shipped since.** Grades (`weight_percent` was being extracted, validated and
then thrown away — into a note for events, nowhere at all for assignments) ·
recurring coursework as materialised series · offline read cache · account
deletion · light mode, which the tokens had supported for weeks with nothing
in the app ever setting `data-theme` · route splitting, 217 KB to 136 KB gzip
· skeletons · swipe · pull to refresh · hotkeys · `aria-live` on optimistic
writes, of which the app had exactly one region.

**The method held up again.** Every one of the three defects was invisible in
the UI and obvious the moment something was measured or read back. The glass
tab bar rendering as a solid cream slab on iOS 16 was found by reading the
COMPILED bundle rather than the source — Lightning CSS emits an opaque
fallback for every `color-mix`, and the fallback is the base colour at full
strength.

**Two claims in the review itself were wrong**, which is worth recording as
its own lesson: it reported that data export did not exist and that
`EmptyState` had no action slot. Both existed. A grep for the wrong identifier
is indistinguishable from an absence.

### Reachability — Sep 2026

A sweep for the failure mode this file already records four separate instances
of: **a mechanism that exists, works, and is never reached.** It is worth
naming as a class rather than a run of bad luck, because it is invisible from
both ends — whoever wrote the mechanism can see it working, and whoever opens
the app sees a feature that is simply not there. Nothing fails, and the types
are all correct.

**`assignment_series` was a write-only table.** `createSeries` inserted a row
and nothing ever read one back. The schema had already been written as though
the missing screen existed: the table comment describes turning a series off,
there is a partial index `where active` serving a query nobody had written,
and `missingDays` documents itself as idempotent so it can run "whenever a
series is created or edited" — when nothing edited. The practical cost was the
largest in the app, because repeating work is the highest-leverage capture and
the hardest to undo: one tap makes up to two hundred rows, and correcting a
wrong weekday or a changed term end meant deleting them by hand. There is now
a list under "Something every week" that can end, restart, re-date, top up and
delete a pattern.

Deleting offers to remove the instances, and the scope is narrow on purpose:
unfinished work due today or later, never anything finished and never anything
past. Finished work is the record of a term, and past unfinished work is what
rule 3 says stays neutrally visible and back-fillable rather than tidied away.

**The generator's cap was invisible.** `MAX_INSTANCES` truncates silently, so
a pattern running past it produced a preview whose last date was not the end
date asked for — in a preview whose entire justification is that you can check
it before anything is written. It now says so, and the gap it leaves is
reported in the list and fillable on request rather than topped up silently,
because a screen that writes twenty rows because it was opened is rule 6's
exact prohibition.

**`looksFarOff` had never been called.** It was written to catch the one date
error the paste warnings cannot: a year that was TYPED rather than assumed.
"Essay 3/15/2027" parses cleanly, raises nothing, and lands a deadline
eighteen months out — and the syllabus importer's term check does not cover
that path, because a pasted list has no term.

**`PromptInput` and `ThinkingText` were built, styled and wired to nothing.**
Their CSS was already shipping in `index.css`. Chat used a hand-rolled
single-line `<input>` instead, so a question long enough to be worth asking
scrolled sideways out of view and could not contain a line break. Both are now
in Chat and, more importantly, on the specimen page — a primitive that never
appears there is one nobody checks, which is how they sat unused. `assist.ts`
was also dropping the server's `failure` classification and keeping only the
sentence, so "you have used today's questions" and "the model is unreachable"
arrived identically above a composer that stayed enabled for both.

**`ActivityRings` was deleted rather than wired.** Nothing rendered it, and the
slot it was written for does not exist: Diet already draws four `Ring`s in a
grid, which is the four-at-a-glance reading, and putting it on Today would
have meant new queries on the one screen rule 1 puts a two-second budget on.
Manufacturing a slot to justify existing code is how redundancy enters.

`tests/reachable.test.ts` now guards both shapes structurally — a component
nothing renders, and a table the app writes and never reads. Each was verified
to FAIL against a deliberately planted violation before being committed, and
the table guard was checked against the pre-fix `planner.ts`, where it names
`assignment_series` and nothing else.

### Live calendars — Sep 2026

A Google Calendar, Outlook or university feed, kept in sync: the server re-reads
every subscribed feed every five minutes (`life-planner-feeds` cron,
`functions/feeds`), and the app asks for a sync on open, on return to the front,
and every two minutes while visible. Mirrored events carry `events.feed_id`, are
read-only by construction (the client never edits or deletes an event), show
their calendar's name where a hand-added event shows its kind, and are removed
when the feed is. The one-time timetable importer stays, for fixed timetables you
want as ordinary events you own.

**Why a secret iCal address and not the Google Calendar API.** The API needs a
Cloud project, OAuth, token storage and — decisively — `calendar.readonly` is a
sensitive scope: unverified apps cap at a hundred users behind a warning screen.
The address costs none of that and works for every provider. The lag people
report with calendar URLs is the SUBSCRIBING app's poll interval, which here is
ours. The API remains the upgrade path if five minutes is ever too slow.

**It needed its own parser.** `icsparse.ts` was right for a confirmed one-time
paste and wrong for an unattended mirror: it converted UTC with one fixed offset
(an hour out after the clock change), expanded repeats forward from the FIRST
occurrence and stopped at sixty (a weekly meeting begun in 2024 yielded nothing
now), and ignored cancelled and moved instances. `_shared/feed.ts` expands in
wall-clock time in each event's own zone, applies EXDATE and RECURRENCE-ID, and
leaves out — and names — any repeat rule it cannot read rather than expanding it
partly. Three planted bugs were each caught by its tests, which also pass under
five host timezones.

**Security.** The server fetches a URL a user typed, so every hop — including
redirects, followed by hand — is checked by name and by resolved address, with a
byte cap and a timeout. The sync runs as the service role, so ownership is part
of the key: `(feed_id, user_id)` must reference a feed that account owns, or one
account could stamp another's feed id on its own rows and the other's sync would
delete them. The sync scopes by account as well. Ten feeds per account, enforced
by trigger because the table is writable through RLS.

**Found by running it against real Google output**, none of which the fixtures
could have shown:

- Google sends no ETag and no Last-Modified, so conditional requests never fire
  and every sync reads the whole feed. That exposed a CPU risk: the recurrence
  walk converted every occurrence since a series began. A daily series from 2010
  took 1,486 ms; only converting occurrences near the window takes 35 ms, same
  result. An edge function has a CPU ceiling.
- Google rewrites DTSTAMP on every event on every download, so a hash of the
  body never matched. Stripping DTSTAMP fixed a public calendar — and a private
  primary calendar still never matched, varying between downloads in some other
  way that changed no event. The fingerprint is now of the PARSED result (the
  window's occurrences and what could not be read), which no volatile byte can
  move and every real change must. Parsing is cheap; what an unchanged sync now
  skips is reading back every mirrored row and diffing it.
- Google answers 429 after about a dozen reads in fifteen minutes. A rate-limited
  feed is now held until Retry-After (ten minutes if absent) through the sync
  lease, instead of being retried on the normal cycle.
- A failed sync keeps the last good mirror. Verified mid-429: 22 events still
  there, the status line saying why.

**The first real subscription's first sync was killed.** The feed row was
claimed and never written back — no status, not even the catch's error, which
only happens when the isolate itself dies. The cause was CPU: `time.ts` built a
fresh `Intl.DateTimeFormat` on every call, `wallClockToUTC` builds two, and
subscribing parsed the feed TWICE (once for its name, again in the sync). A
six-year calendar measured 542 ms per parse on a laptop, against a two-second
ceiling on a slower isolate. Formatters are now cached per zone (every date the
app renders gets the same speedup), one-off events far outside the window are
skipped before conversion, and subscribing parses once: 60 ms. The feed healed
on its own two minutes later — the lease expired and the app's keep-alive
synced it — which is the recovery path working as designed. Guards: a direct
test of 20,000 conversions (1,385 ms without the cache) and a large-calendar
parse (317 ms without it), each verified to fail against the old code.

**The unchanged-feed shortcut, observed in production** on the first real
subscription once it fingerprinted the parsed result: a seeding run found no
changes, and the next returned `unchanged` without reading the 545 mirrored
rows.

**A mirror has to know what its events are, or it doubles the week.** Set up
against a real term (Concordia timetable plus Moodle deadlines in one Google
calendar), the raw mirror was wrong in three ways a fresh student would hit on
day one: no lecture was linked to its course, so the course filters showed
nothing from the calendar; "Midterm Exam" arrived as `other`, so it never got
the night-before escalation; and every Moodle deadline appeared twice, once as
the tracked piece of work and once as "PHYS 205 - Quiz #3 is due" at the same
minute. The sync now reads each occurrence before writing it
(`_shared/feedsync.ts`): the course code in the title links it to that account's
course, a narrow title rule marks real exams (never "practice", "sample" or
anything "due"), and an occurrence is dropped when it lands within a minute of
tracked work or an owned event AND shares a meaningful word with it. Both
conditions, because a 14:00 lecture and a 14:00 exam are different things and
every course has an "Assignment 2". It only ever hides a copy — if the source
moves the deadline the instants stop matching and the event reappears beside
the work, which is how the move gets noticed. First run: 168 updated, 24
duplicates removed. Course and kind are part of the fingerprint, so adding a
course re-links an unchanged feed on the next sync.

**A Moodle address "didn't work", and the app blamed the paste.** Concordia's
Moodle sits behind AWS WAF, which answers any non-browser client — the edge
function included — with HTTP 202, an empty body and `x-amzn-waf-action:
challenge`. 202 is a success, so the sync read an empty feed and said the
wrong address had been copied, when it was exactly the right one. The fetcher
now recognises a bot check (AWS and Cloudflare headers) before reading the
status and says what is actually true: this server only admits browsers, and
the working route is to subscribe to it in Google Calendar and add Google's
address here — which is how this account's Moodle deadlines already arrive.
The sync does NOT impersonate a browser to get past it; the check is the
university's to set. A Moodle PAGE (course, dashboard, calendar view) is
caught by name, like the Google browser-bar link, with the menu path to the
real export address. Both verified against the deployed function.

### The diet tracker is gone — Oct 2026

Asked for: "get rid of the meal planning infrastructure entirely … it doesn't
fit well in a production grade app." The scope chosen was all of it — food
log, macro targets and rings, saved meals, protein-gap suggestions, weigh-ins
and the trend chart, barcode and photo logging, USDA and Open Food Facts
lookups, and the `parse-food` edge function. This is a tool for keeping
academic work in order, and food tracking was the largest part of it that was
not — the same reading Phase 7 applied to the mood check-in.

- **Tables dropped, not abandoned** (0033): `food_entries`, `food_items`,
  `saved_meals`, `macro_targets`, `bodyweight` and the `food_source` enum. A
  table nothing reads still holds personal data and still reads as a feature.
  Anyone wanting their history has to export before 0033 runs.
- **Abood lost its food scope**: no food, saved meals or weigh-ins in the
  context, and `log_saved_meal` / `set_weight` are no longer actions — the
  validator refuses them as unknown. Older transcripts can still hold such a
  proposal; Chat shows it without a "Do it" button rather than one that would
  do nothing.
- **The budget's rationale changed.** Chat's stand-down used to say the rest
  was "kept for logging food". With no food path, it says everything else
  still works. The `food` budget kind and `FOOD_CALLS_PER_DAY` are gone.
- **`Ring` and the `--m-*` tokens went too.** Ring was only ever rendered by
  the Diet screen (the specimen page aside), so leaving it would be exactly
  the unreachable-component case `ActivityRings` was deleted for. So were the
  palette tests that kept the brand clear of the macro hues.
- `zxing-wasm` is no longer a dependency.

**Deploy order matters.** Ship the app and the edge functions first, then run
0033 — an old client hitting a dropped table would fail its reads. And delete
the deployed `parse-food` function by hand (`supabase functions delete
parse-food`); removing it from the repo does not undeploy it.

### Abood, cheaper per message — Sep 2026

Asked for after Abood became a companion on a free Groq key (8,000 tokens a
minute). Measured on the live account: the planner context was ~1,940 tokens
on every message, plus a second model call per message for memory, plus the
model's default reply allowance, which Groq counts up front — one question
registered as ~6,500 tokens "requested".

- **Sections by message** (`scopesFor`, no model call): conversation gets a
  ~130-token snapshot of what is next; planner questions get only work, food
  or checklist as needed (~1,250). Errs toward including; a short follow-up
  inherits the previous question's sections. If a snapshot was not enough the
  model sets `needs_planner` and is asked once more with everything.
- **Short labels** (`w1`, `e3`, `m2`) replace uuids in the prompt and are
  translated back after validateChat has checked them against what was shown.
- **Memory in the same call** (`remember` in the chat schema); the separate
  extraction call is gone.
- Events 14 days out unless the message reaches further (exams, month
  names: 31); six turns of history at 400 characters each.
- Groq: `max_completion_tokens` 1,200 and `reasoning_effort: low` for gpt-oss.
  A per-minute throttle now falls back to Gemini; a daily limit does not.

Found while measuring: given bare dates, the model worked out weekdays itself
and got them wrong ("due Sun Oct 2" for a Friday). Every stamp in the context
now carries its weekday. Verified live: correct weekdays, ~2s replies.

### Abood by iMessage, through a Mac — Sep 2026

Apple has no iMessage API, so `bridge/imessage/bridge.mjs` runs on a Mac
signed into Messages (a LaunchAgent, `install.sh`): it polls
`~/Library/Messages/chat.db` with the system sqlite3 for new one-to-one
iMessages it did not send, posts each to `functions/imessage` with a shared
secret (`IMESSAGE_BRIDGE_SECRET`), and sends back what that returns through
Messages via osascript, with the text passed as an argument, never spliced
into the script. It holds a caffeinate assertion while it runs, starts from
the newest message on first run, and waits (rather than crash-looping) until
Full Disk Access is granted to the node binary. Zero dependencies.

The server side is the shared door (`_shared/door.ts`, now also Telegram's):
same commands, memory, budget and confirm-in-app rule. A handle links only by
texting a one-time code (Settings > iMessage > Connect this phone, which opens
Messages pre-filled); **an unlinked handle gets no reply at all**, so a bridge
on a personal Apple ID can never answer a friend. `imessage_bridge` records
the address and a five-minute heartbeat so Settings can say when the Mac is
off. Needs a second Apple ID signed into Messages on the Mac — texting your
own Apple ID from your own phone is texting yourself.

Verified against the live function by playing the Mac's side: 401 without the
secret, silence for an unlinked number, a link redeemed from a formatted
number, and a correct answer to "what classes do I have tomorrow".

### Abood on Telegram, with a memory — Sep 2026

The five-piece bot recipe (channel, webhook, server, memory, LLM) built as a
second door into the same Abood: `functions/telegram` is the webhook for the
digest's existing bot, `_shared/abood.ts` holds the context, memory and the
one `askAbood` call both doors use. One transcript (`chat_messages.via`),
one daily budget, one memory; a proposed change is confirmed in the app only.

- **Trust:** the secret Telegram sends with every update, compared in
  constant time (`TELEGRAM_WEBHOOK_SECRET`); chats link only by redeeming a
  15-minute one-time code the account made (Settings > Text Abood).
- **Memory (0030):** `memory_facts` + pgvector (768-d Gemini embeddings),
  recall by cosine similarity with a recency fallback, at most three facts
  learned per message, never deadlines/food/weight (the planner holds those
  fresh) nor health, money or credentials. Learned facts are announced and
  listed with Forget in Settings; `/memory`, `/forget yes` in the chat.
- **Groq free tier is 8,000 tokens a minute** and one question with planner
  context is ~6,500, so quick successive messages hit it. A 429 with a wait
  of 8s or less is waited out and retried once.
- `setup.mjs` registers the webhook after finding the chat and reuses the
  stored chat on a re-run (getUpdates returns 409 under a webhook).

Verified live end to end: a simulated update from the linked chat was
answered in ~4s; a stated preference was extracted, embedded and stored, and
a later related question was answered from it. Test rows were deleted.

### Abood went dark, for three stacked reasons — Sep 2026

Every chat question failed, and each layer hid the next:

1. **Groq stopped serving `llama-3.3-70b-versatile`** to this key. Groq now
   reads its catalogue on a withdrawn model, ranks current ones (families
   known to honour strict JSON first; speech, moderation, routing never),
   retries once and remembers the pick. The default is `openai/gpt-oss-120b`.
2. **Strict mode rejected the chat schema**: every object must carry
   `additionalProperties: false`, which Gemini-shaped schemas never did.
   `strictSchema` closes them, and any schema complaint falls back to JSON
   mode on the same model — callers validate the reply either way.
3. **The account's Gemini key field held a Groq key** (`gsk_…`, the same key
   as the Groq field). An account key overrides the shared one, so food
   parsing, the syllabus reader, the briefing and chat's fallback all sent
   Google a Groq key and failed "API key not valid" — reported as "could not
   reach the model". Cleared on the live account (the Groq copy kept); both
   functions now ignore a key in the wrong field, Settings refuses to save
   one, and Gemini classifies an invalid key as `unconfigured`.

Chat now falls back to Gemini when Groq fails for provider reasons (never for
a refusal or a spent quota), and Gemini treats a 503 "high demand" like a
retirement: one retry on another current model. The failure copy no longer
names GEMINI_MODEL — it blamed Gemini for Groq's fault. Verified live: chat
answered through Groq; a breakdown answered through
`gemini:gemini-flash-lite-latest` after the default returned 503.

Unanswered questions were saved as ordinary replies, so "Could not reach the
model" read as something Abood said. `chat_messages.failed` (0029, backfilled
from the app's fixed failure sentences) draws them as a dashed note.

### One material, app-wide — Sep 2026

Asked for after the Week block styles landed: "implement this design principle
throughout the app … it looks too generic". `src/styles/material.css` (in
`@layer components`, so a Tailwind utility on the same element still wins —
unlayered, it beat every utility regardless of specificity) is what every
surface is made of now:

- **`.mat`** — the cloisonné panel generalised. Corner light, a masked rim
  that catches it at two corners, a glow rather than a flat drop shadow.
  `data-block` + `--b` makes it a course's glass. `Card` is this at three
  lifts; `hero` adds a phthalo pool of light.
- **`.well`** — every text field and select, recessed, lighting in ember on
  focus. **`.kicker`** replaced the `action-chip` labels, which rendered every
  form label as a full-width pill indistinguishable from a button.
- **`SectionHead`** — title, count in display numerals, a fading rule, and
  the section's controls at the end. Every `type-h2` section heading was
  swept onto it; every page h1 is `.page-title`.
- **Work is slips** (`AssignmentRow`): one course-glass surface per item with
  the countdown as a display numeral in its urgency colour, the unit in words
  under it and the full label for screen readers. `EventSlip` is the same
  shape for things you attend. Month is glass tiles with course marks (a ring
  for a deadline, a bar for a class). Courses are tiles; grades are one bar
  out of 100 (solid marked, hatched on the calendar, empty unnamed) — how much
  is decided, never how well.
- **Today gained Now/Next**: the class under way, with time left and a
  progress line, or the next one. Today had never shown an event at all.

**The shake.** Reported from the phone: "a lot of ui elements shake when
clicked". Five separate causes, none visible from a laptop:

1. `fx-depth` lifted 2px on `:hover` and dipped 1px on `:active`. A phone
   fakes hover on tap, so each tap jolted up and down inside 100ms. Presses
   now scale in place; lifts need `(hover: hover) and (pointer: fine)`.
2. Pull-to-refresh had no dead zone, so the 1-3px a fingertip drifts during
   a tap was a pull: at the top of Today every tap nudged the page down and
   flashed "Pull to refresh". Now 12px, mostly downward.
3. The work list's entrance re-ran on every id change, so ticking one item
   off faded and slid the whole list in again. Only new rows animate now.
4. `fx-magnet` eased every transform with an overshooting spring, so What
   now's press sprang back past full size. The tick popped 0.72 -> 1.12. Both
   now settle without overshoot.
5. The Week styles' hover lifts were gated on `(hover: hover)` alone, which
   some Android phones report.

Verified by auditing the live compiled CSS for every `:hover`/`:active`/
`:focus` rule that moves or resizes anything: what remains on touch is the
intended in-place press scale and colour changes. NOT verified on a phone —
the verification browser cannot emulate touch or a narrow viewport, and a
backgrounded tab neither renders nor reports layout shift, so a live tap test
from here proves nothing.

### Week block styles — Sep 2026

Week draws the same data five ways, chosen from a segmented control at the top
of the screen and remembered per device (`lib/calendarStyle.ts`, localStorage,
for the reason theme is: a seven-column grid is right on a laptop and wrong on
a phone). Rail is the original spine. The four added:

- **Bubble** — Google's schedule bubble as cloisonné: a course-tinted glass
  wash inside a hairline rim that catches light at two corners, HEIGHT
  proportional to length, free time between blocks written out ("45 min
  free"), a progress line along whatever is under way.
- **Hours** — a real time axis. Seven columns on one shared axis at 64rem+,
  a grid per day below it. Overlaps go side by side (`placeSpans`, lanes per
  cluster so one clash does not narrow the whole day); deadlines and instants
  are flags on a hairline, not slivers; an ember line for now, with a faint
  echo across the other days.
- **Ticket** — an Edmondson railway ticket: stub with the time, a diagonal band
  in the course's colour, a perforation with real notches (masked, so
  `drop-shadow` rather than `box-shadow`), and a punch through the stub once
  the class has run.
- **Ledger** — a printed Swiss timetable: no boxes, big tabular numerals, and
  each thing's length as a rule in its course colour.

Every style keeps each deadline's done toggle, written urgency and tap to open.
Facts are computed once in `components/calendar/items.ts` so the styles can
only disagree about appearance.

**The course law was widened, on purpose.** Courses may now TINT a calendar
block — a translucent wash, never an opaque fill. Channel triplets
(`--c-N-rgb`) live in tokens.css and a `[data-block]` rule composes each
block's tints against its own `--b`. `tests/palette.test.ts` composites the
strongest wash of all eight courses in both themes and requires 7:1 for cream
and 4.5:1 for `--text-mid`. That floor is the reason the dark wash is only
0.11: the first attempt at 0.17 failed it, so the extra colour went to the rim,
the glow and the edge bar, which carry hue without sitting under text.
Events with no course are glass, not a neutral tint — Travel and Gym are most
of a real week, and washing them in cream made them outshine every lecture.

**Found by looking at the real week, not the fixtures:**
- One WeBWorK due at 12:00 a.m. stretched the whole week's hour grid back to
  midnight. The grid now fits to events, and a flag outside the fitted hours
  is pinned to the edge it fell past with its time written.
- Timetable exports put the room first: "MB S2.210 - COEN 231-U - LEC".
  `readTitle` leads with "COEN 231 Lecture" and only rewrites a title that
  matches that shape exactly; anything typed by a person is left alone.
- A two-line flag, because a seventh of a laptop screen truncated a deadline's
  title to nothing once its time was added.
- `needsOnboarding` read a failed query as "never onboarded", so a returning
  account whose token was refreshing at launch was shown the first-run
  screen. It throws now, and unknown means not a first run.
- An aborted view transition (tab hidden mid-switch) rejected two promises
  nobody listened to.

### A blank brown screen — Sep 2026

`WhatNow` called `useMagnetic` after an early return, so the render that first
had assignments called one more hook than the one before and React threw #310.
With no error boundary React unmounted everything, leaving only the page's
atmosphere: no text, no navigation, nothing saying an error happened. Adding a
course was the trigger only because it was the first time the component went
from empty to not.

Three layers were missing and each is now there. `react-hooks/rules-of-hooks`
was configured but `npm run check` never ran lint, so the rule had caught this
and nobody was told; `check` runs lint first now. `ErrorBoundary` wraps the app
and each screen (keyed on the screen, so navigating away clears it) and asks
the service worker for an update when it catches, since a production render
error is usually already fixed in a later deploy. And the service worker served
navigations cache-first, so the fixed build only reached the phone on the
SECOND open; navigations are network-first with a two-second timeout, falling
back to the cached shell offline.

### A documented deviation from the colour law — MOOT, Oct 2026

The trend chart this describes was removed with the diet tracker. Kept for the
reasoning.

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

### Phase A — audit and fixes, Oct 2026

A read-only audit of every route, component, edge function and migration on
3 Oct, run against the code and the live database rather than this file, then
five fix batches approved and shipped the same day. Thirty-four findings; the
full ranked report is the artifact "Life Planner audit". What follows is what
changed and why.

**The outbox could be jammed for good, and normal use did it.** The drain
stopped at the first error and retried that write for ever, so one write the
server would never accept held every later write hostage — optimistic on
screen, never sent, gone on the next reload — and `clearOutbox` existed with
no screen calling it. Ticking the same checklist item on two devices was
enough (the unique `item_id, local_day`), and so was restoring a course whose
name had been taken. Failures are now classified: transient ones stop the
queue and back off; permanent ones are set aside with everything that depended
on them, named in plain words in a review sheet with Try again and Discard,
and the queue carries on. A duplicate insert counts as done; every insert
carries a device-made id, so a retry after a lost response cannot duplicate;
Web Locks keep two tabs from draining together; entries carry the account that
queued them, so a shared laptop never replays one account's writes as
another's.

**One optimistic layer, replayed from the outbox.** Only checklist ticks used
to be optimistic, each screen keeping its own set of taps in flight. Marking
work done, deferring, capturing, triaging and steps all waited for a reload
after the write reached the server — half a second to two online, never
offline, where a captured thought did not appear in the inbox although seeing
it appear is capture's only confirmation. The two private sets were wrong on
their own terms: Today's only added, so a double tap showed done when it was
not; Fill-in-a-day's was never cleared, so once a tick synced it inverted the
correct server state — and the second tap queued the duplicate that jammed the
outbox. `lib/optimistic.ts` replays every queued write, and every write that
landed after the data was read, over the loaded day. Every step is idempotent,
so the overlap with a reload can never double anything.

**Today stays mounted, so it has to notice the date.** iOS keeps an installed
app alive overnight; resumed in the morning, Today showed yesterday, and once
anything re-rendered the selected checklist day stayed on yesterday, so the
morning medication tick was recorded as a back-fill of the day before. Today
now recomputes the day on the minute and on resume, rolls the selection over,
and re-reads after a long absence. A timed deadline is late the minute it
passes rather than at midnight.

**Two database functions let anyone with the public key act on any account.**
`ensure_ics_token` and `record_ai_use` were SECURITY DEFINER, took the user id
from the caller, never checked it, and were executable by `anon` — Supabase
grants EXECUTE on every new public function to anon by default, and `revoke
from public` does not undo it. Confirmed live with `has_function_privilege`;
neither was called. 0034 fixes both, and two migration tests fail the build if
a definer function is ever executable by anon, or callable by an account while
accepting a user id. The test harness used to grant table privileges AFTER the
migrations, silently re-granting whatever a migration revoked; it now applies
Supabase's default privileges first, as production does.

**"Write-only" keys were read back.** The app checked whether a Gemini or Groq
key was set by selecting the key, so the raw keys reached the browser on every
Settings open. The columns are no longer selectable by the account
(column-level grants; a table-wide grant would override a column revoke) and
`own_key_status()` answers yes or no.

**The iMessage bridge belongs to an account.** It was one global row every
signed-in account could read: each saw the owner's bridge address and a
Connect button that would have linked their phone to the owner's Mac. Settings
now issues a bridge key, shown once, whose hash identifies the account, and
the function answers, links and queues check-ins for that account alone. The
running bridge's old shared secret was accepted once for the single account
with linked phones, and the bridge moved itself onto the new scheme on its next
heartbeat — verified in production.

**The Toronto default was still answering.** `_shared/time.ts` exported
`TZ = 'America/Toronto'` and defaulted every function to it. Removing the
default made the compiler list every call without a zone: the weekly review
counted Toronto days for every account, Abood's "sitting for N days" did the
same, and two fallbacks hardcoded Toronto. All fixed; the fallback is now UTC.

**Grade standing was missing the largest part of every course.** Exams and
presentations are imported as events, and the importer wrote their weight into
a note because events had nowhere to keep it, so a midterm and a final worth
sixty or seventy percent never reached the grade bar. Onboarding dropped
assignment weights too — the same bug this file records fixing, back on a
second path. Events now carry a weight and a mark (0035), and Grades lists each
weighted exam with a field for its mark, since an exam has no editor.

**The briefing called lectures assignments due.** It took the first fifteen
events by start time and labelled anything not an exam "assignment" under DUE
TODAY. With a synced timetable those fifteen were lectures, and an exam later
in the week fell off the list. Classes now arrive as today's timetable,
attended rather than due; exams are fetched on their own.

**Smaller, each verified:** the account's time zone can be changed in Settings
(it was set once from the first device and fixed for good); a failed timezone
read no longer overwrites the account's zone; Search results that looked
pressable now all act, finished work opens, a failed search says so and a
comma no longer breaks the course filter; Abood's Clear asks first and says it
reaches Telegram and iMessage; an unsaved question keeps its draft; proposal
dates carry their weekday; Escape closes only the top sheet; a 0% grade is
kept and a link without https:// no longer blocks Save; the calibration that
was measured and never applied now sizes the forecast and What now; first run
stopped suggesting the first user's own "Medication" and "Creatine"; swipe rows
set `touch-action: pan-y`, without which a phone may cancel the gesture as a
pan; the briefing renders from the day's cache and no longer animates
grid-template-rows over the page; the skeleton pulses on opacity; Today reads a
60-day window of events instead of every future one (350 rows for one account,
against a 1,000-row cap); a calendar can be renamed.

**Guards added**, each verified to FAIL against a planted violation first:
outbox refusals set aside and duplicates counted as done; the optimistic
replay; definer functions and anon; definer functions taking a user id; key
columns unreadable while every other column stays readable; bridge rows
private to their owner; server time calls without a zone (compile time); a
`/NN` alpha colour utility, which compiles to color-mix with an opaque iOS
16.0-16.1 fallback; a swipe without its touch-action; and an exported function
that nothing but a test calls.

**Deployment, and a claim corrected before it did harm.** The audit said all
five diet tables were empty; only two had been counted, and `macro_targets`
held one row — one account's old calorie and protein bands. 0033 was held,
the owner was told, and it ran on 3 Oct once they confirmed. The `parse-food`
function is deleted. A count is not a count of everything until every table in
the claim has been queried — the same lesson as the wrong-identifier grep.

**Still open.** Not verified on a real phone: swipe, the iOS keyboard over
sheet inputs, safe areas. The Mac's bridge never collected queued check-in
texts (sixteen waiting since 29 Sep), most likely because that Mac runs an
older `bridge.mjs` without the outbox poll; texts older than six hours now
expire at collection instead of arriving as a burst, so updating the Mac
(`git pull`, re-run `install.sh` with a key from Settings) is safe.

**The rules were revisited the same day**, on the owner's instruction to
adjust whatever held the work back. Each changed rule above carries a
"Formerly" note with what it replaced and why: the friction veto became the
progressive-disclosure test; streaks became an opt-in module; the colour law
was restated for themes and for what had actually shipped; "don't optimize
prematurely" became a performance budget; the calm-instrument motion limits
became the motion system; light-derived-from-dark became designed pairs;
routing by URL, grade tools that compute without grading, and user-chosen
hiding were adopted as conventions. The exclamation-mark ban was kept.

### Phase B — the prototype, built into the app, Oct 2026

The owner approved the Phase B prototype ("Life Planner foundation") and
asked for all of it. Shipped in steps, each pushed as it landed:

1. **Tab bar and capture.** One lit capsule moves between tabs (and in the
   rail and the Week style picker) and stretches as it travels
   (`moveCapsule`); More opens from its button and closes into it. Capture
   has a round send button that lights as you type; the words drop toward
   the inbox and a receipt shows under the field, because the inbox is below
   the fold on a phone.
2. **Ticket slips.** The countdown in a stub behind a perforation, a faint
   punch ring marking the done target; finishing punches it and the disc
   falls away. The glass slip stays a choice in Settings (rule 13). Undo for
   five seconds after finishing. Now/Next became a printed timetable strip.
3. **Opening work.** Sheets render into the body; on a phone the page
   behind recedes to 94% and the work's title flies from the slip into the
   sheet's heading, and back on close. Contents arrive a beat after the
   surface.
4. **No animation library.** See the working agreement. Named curves live in
   tokens.css (`--ease-out/exit/glide/settle/drift`) and `EASE` in
   motion.ts, kept identical by a test.

5. **Appearance settings** (per device, `lib/appearance.ts`, mirrored onto
   `<html>`): work slips (ticket or glass); glass off, on the bars, or on
   every surface, the expensive one kept as a choice under rule 13; blur
   that comes into focus as scrims and menus open; and motion full or calm.
   Calm keeps every animation rule 12 requires and drops the flourishes:
   the chad, the capsule stretch, the receding page, the flying title, the
   cascade.

Found on the way: a cancelled animation's `finished` promise rejects, and
`.finally()` passes that on, so every interrupted animation was an uncaught
page error (guarded); Week's Ticket style already owned `.ticket`, which
silently re-laid the new slip until the classes were renamed.

### Rule 12 — every tap animates, Oct 2026

Reported from the phone: ticking off work on Today made it vanish. Three causes,
each a cut by itself:

- **The row was unmounted in the same render.** The optimistic layer moves a
  finished item out of the open list immediately, so React removed the row
  before anything could play. `usePresence` (`lib/usePresence.ts`) keeps an item
  that has left the data rendered, `inert`, at its old index until its exit has
  finished; then everything below closes up as a cascade (`measureBelow` and
  `closeUp` in `motion.ts`). The data stays honest — only the picture lingers.
  Today's work and inbox and low-battery mode's one piece of work use it. A
  finished row shows its tick land, then leaves right; tomorrow leaves left.
- **Reduce Motion was a blanket cut.** `index.css` shortened every transition
  and animation to 0.01ms. Now each moving animation has a fade form; colour
  and opacity transitions run as written.
- **Sheets closed with a cut.** `Sheet` returned null the moment it closed, and
  most sheets are removed by their parent anyway. Sheet now animates out, and
  `SheetPresence` keeps a conditionally rendered sheet alive while it does.

Also: ticks animate when cleared, not only when set; a committed swipe stays
where the finger left it instead of springing back before leaving; section
counts rise in when they change; Week's done toggle fills over 260 ms with a
glow. Guards in `tests/motion.test.ts`, each verified against a planted
violation: no reduced-motion cut, every conditionally shown sheet wrapped in
`SheetPresence`, Sheet never returns null on close, both work lists rendered
through presence. NOT verified on a phone.

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
- **Fill-in-a-day inverted a synced tick, and the retap jammed every write.**
  Its private set of taps in flight was never cleared, so once the outbox
  drained and Today re-read, the server's "done" was flipped to "not done" on
  screen. Tapping again queued a duplicate insert, the unique key refused it,
  and the outbox — which then stopped at the first error for ever — held every
  later write behind it. Found by reading the component against the outbox,
  not by anything failing.
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
- ~~**The 7-day pause theory is untested.**~~ Disproved by simply continuing to
  use the project. Awake throughout, no pause ever observed.

Deliberate Phase 0 scope decisions, so they are not mistaken for gaps:

- **No feature tables.** Assignments, events, courses and the checklist are Phase 1. The digest builder correctly returns the empty digest ("Nothing due.") — which is a real specified code path, not a placeholder, and it is the branch hardest to notice being broken.
- **The offline outbox is the mechanism only**, exercised on one write type. Phase 1 routes its writes through it unchanged.
- ~~**Web Push is written and unit-tested but unproven.**~~ PROVEN, 8 Sep 2026.
  The rule set here in advance was "promote it to 10 only after the 5-day
  soak", and the soak passed, so it was promoted. Telegram sits at 20.

  Worth keeping the shape of this decision: the criterion was written down
  BEFORE the evidence existed, which is why the promotion took one command
  rather than an argument about whether it felt reliable enough.

Three tokens deviate from `docs/design-system.md` to satisfy its own contrast floor. Each is documented inline in `tokens.css` with its measurement. Revert if you disagree.

Design system: **built** (Phase 0.5). Eight primitives, specimen page at `/?specimen` in dev.

_Update this section at the end of every phase._
