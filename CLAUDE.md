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
