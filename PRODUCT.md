# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students with academic work and daily obligations to keep in order — course
deadlines, a checklist, food and macro tracking, and a calendar of events.
Built for one real user through 19 Aug 2026; the change to a multi-user
product is permanent and deliberate. No assumption that there is one user,
one timezone, or one target may re-enter the code, schema, or scripts — see
`CLAUDE.md`'s "Built for one, architected for many."

The practical test for any new work: if a second account signed up tomorrow,
would this be wrong? If yes, it is wrong now. If merely unpolished, that is
fine and can wait.

## Product Purpose

Getting academic work and daily obligations in order with as little friction
as possible. Success is the app staying openable in a bad week — a technically
correct planner that feels like a chore is a failed planner, and the failure
is silent: it stops getting opened one day and never gets opened again.

## Positioning

**The AI leverage is the mechanism a generic planner (Notion, Google
Calendar, Todoist stitched together) cannot copy without becoming this
product.** A chatbot ("Abood") scoped to a bounded slice of the user's own
data — open work, a month of events, today's checklist and food, saved meals,
recent weigh-ins — that must cite the ids it used and refuses to invent one it
was never given. Syllabus import that extracts deadlines without ever
calculating a date the model does not actually know. Task breakdown that
rejects vague-verb suggestions rather than trusting the prompt. Protein-gap
suggestions computed by subtraction over data already loaded, needing no
model and no network, so the answer still exists when the shared quota is
gone.

The throughline: the model does structuring work a generic planner leaves
entirely to the user, and every one of these paths enforces "never a
confidently wrong deadline" mechanically — never by prompt alone.

## Operating Context

A student opens the app to see what's due right now (the Today screen, in
under two seconds, no navigation — rule 1), captures a thought with minimal
required fields before it evaporates, logs food through one of four paths
(typed, photo, barcode, USDA lookup) that all land on the same confirmation
screen, and receives a daily digest by push notification or Telegram. Course
syllabi are pasted or imported wholesale; recurring coursework (a weekly lab,
a biweekly problem set) is set up once as a pattern rather than typed
repeatedly. A subscribable .ics feed puts deadlines in whatever calendar app
is already on the user's lock screen.

## Capabilities and Constraints

- Local time is the account's own timezone (no longer a hardcoded
  `America/Toronto`), computed from `app_settings.timezone`; a "day" is
  always the user's local day and must survive DST.
- Free tiers are a hard current constraint, not a design assumption: one
  shared Gemini/Groq key funds every account's food parsing and chat unless
  an account supplies its own key; Supabase's free row and bandwidth limits
  are a single shared pool. Per-user cost is a design input.
- Minimum required fields at capture — every mandatory field is a chance for
  a thought to evaporate before it's recorded.
- Never silently lose data (a failed sync must be visible and recoverable)
  and never silently write (AI-parsed food, AI-extracted syllabus dates, and
  chatbot actions are all shown for confirmation before touching the
  database).
- No streak-shaming: no streak counters, no broken-streak states, no guilt
  copy. Missed days appear neutrally and are trivially back-fillable.
- No pure red anywhere in the UI (overdue uses a clay-rose token instead).
- Deliverable email, billing, support, and abuse handling are explicitly out
  of scope for now. What is not deferred is the *shape* of the code, schema,
  and scripts, precisely so the operations work can be picked up later
  without a rewrite.
- Undecided: whether macro targets should stay entirely absent for a new
  account until asked for, or be offered during a first run (currently
  absent, and defensible either way — recorded in `CLAUDE.md`).

## Brand Commitments

- Copy voice: plain, active, sentence case. Errors say what happened and
  what to do, without apologizing. Empty states are neutral or an
  invitation, never a lament. No emoji, no exclamation marks. Praise is
  allowed for a moment ("that's everything for today") but never for
  anything that accumulates into a losable streak.
- The colour law: three colour systems (urgency, macros, courses) are kept
  separated by temperature and never blur into one another. No colour value
  may be written anywhere except the token file.
- No further visual reference, era, material, or font has been locked in.
  Visual direction beyond the above is open for a later design pass.

## Evidence on Hand

No customer testimonials, case studies, press, or third-party benchmarks
exist, and none should be fabricated. The product's own build log
(`CLAUDE.md`) is unusually detailed real evidence: verified bugs, deliberate
scope decisions, and a running account of what shipped and when. Treat it as
authoritative operating history, not marketing copy.

## Product Principles

1. When a tradeoff comes up between "more capable" and "less friction," take
   less friction — every time. The hard part of this project was never the
   features; it's staying openable in a bad week.
2. Nothing may assume the user is the person who built it. No seeded
   personal data, no hardcoded timezone, no target that is somebody's actual
   bulk. A new account's first screen is the most important one in the
   build and the one with the least work in it.
3. AI leverage is real leverage, not decoration: every model-backed feature
   must fail safely into "I don't have that" or a declined proposal rather
   than a confident wrong answer, because a confidently wrong deadline is
   worse than no chatbot at all.
4. Reversibility matters as much as capability. A feature that writes many
   rows in one action (a recurring pattern, a bulk import) is judged on
   whether a mistake inside it can be corrected without deleting everything
   by hand.
5. Verify against reality rather than trusting documentation, including this
   file. The project's own history shows self-review getting details wrong
   by grepping for an absent identifier rather than reading the actual code.

## Accessibility & Inclusion

`prefers-reduced-motion` is supported and treated as an operating-system
accessibility setting belonging to whoever is using the product — not a
judgment about any one user's mood or wellbeing, and never grounds to
withhold capability, motion, or visual richness by default.
