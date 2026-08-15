# Prompt for Claude Opus 5 — Personal Life Planner

> Copy everything below the line into a fresh Claude conversation.

---

## Role & context

You are my technical partner building a personal life-planning web app. I'm the only user. I have ADHD and am dealing with what may be depression, which means the app's success depends as much on **friction reduction and emotional tone** as on features. A technically correct app that feels like a chore is a failed app.

Before writing any code, do two things:

1. Ask me any clarifying questions where my spec is genuinely ambiguous or where a decision would be expensive to reverse. Ask them all at once, not one at a time.
2. Confirm the architecture and phase plan below, flagging anything you'd change and why. Wait for my sign-off.

Then build in phases. Do not attempt to output the entire application in one response — I'd rather have one phase working end-to-end than five phases half-written.

---

## Hard constraints

- **$0/month, indefinitely.** Free tiers only. If a feature is impossible for free, say so explicitly and offer the closest free alternative rather than quietly assuming I'll pay.
- **Accessible from any browser**, phone and desktop, with data synced between them.
- **Installable to my iPhone home screen** as a PWA — no browser chrome, offline reading, syncs on reconnect.
- **Push notifications to my phone that fire when the app is closed.** This is not negotiable and not deferrable. See below.
- I'm in **Montréal (America/Toronto)**. All scheduling is local time and must survive DST.
- I can create accounts, paste API keys, and run CLI commands. I am not an experienced backend developer — explain deployment concretely.

### Push notifications: prove this first

Scheduled push to a closed iOS PWA is the riskiest requirement in this project, and I need it more than I need any other single feature. Client-side scheduling does not fire when the app is closed, so a **server-side scheduled job** is mandatory.

**Phase 0 must deliver a working end-to-end push before any feature work begins.** Not a plan for one — an actual notification arriving on my phone from a scheduled server job, with nothing else built. If this can't be made to work, I need to know in week one, not after the planner is finished.

Present at least two options with real tradeoffs before you build:

- Web Push with VAPID keys, triggered by a scheduled serverless function
- A message-channel fallback such as a Telegram bot or ntfy.sh topic

Web Push is the "proper" answer; the fallback options are markedly more reliable on iOS and cost nothing. Recommend one, say why, and design so the delivery channel can be swapped without touching the digest-building logic. If any of your knowledge about iOS PWA push constraints might be stale, flag it and tell me what to verify myself.

---

## Design principles (non-negotiable)

These override feature completeness where they conflict.

1. **Default view is "Today."** Opening the app answers "what do I do right now" in under two seconds, without navigation.
2. **Capture must be near-zero friction.** Every required field at capture time is a chance for the thought to evaporate. Minimum viable input, always.
3. **No streak-shaming, ever.** No broken-streak counters, no red failure states, no guilt language. Missed days shown neutrally and trivially back-fillable. A bad week must not make the app feel punishing to reopen — this is the #1 reason tools like this get abandoned.
4. **Nothing important is hidden behind a tap.** Surface information; don't make me remember to look for it.
5. **Never silently lose data.** Optimistic UI is fine; a failed sync must be visible and recoverable.
6. **Calm visual design.** High contrast, generous tap targets, restrained motion, no badge-anxiety patterns.

---

## Build phases

### Phase 0 — Foundation + push proof

- Auth (single user, but data must not be publicly readable), Postgres schema, row-level security
- Deployment pipeline, PWA shell installable to home screen
- Timezone-correct date handling — a "day" is my local day, not UTC
- Offline read + queued writes syncing on reconnect
- JSON/CSV export — I want to be able to leave
- **A scheduled server job sending a real notification to my phone, verified working**

### Phase 1 — Core planner

- **Quick capture inbox.** One always-visible text box that swallows anything — "chem lab report??", "email prof", "buy creatine" — into an untriaged pile. No required course, no due date, no category. Triage is a separate, later activity. This is the highest-value feature in the app.
- Assignments: title, course, due date + optional time, estimated effort, status, notes, optional subtasks
- Events (exams, labs, presentations) as a distinct type with its own emphasis
- Courses as first-class entities with user-assigned colours
- **Proximity colour flags** on every assignment and event. Start with these thresholds, editable in settings:

  | State | Window |
  |---|---|
  | Overdue | past due, not done |
  | Critical | due within 48h |
  | Urgent | 3–5 days |
  | Approaching | 6–14 days |
  | Distant | 15+ days |

  Colour must never be the only signal — pair each state with a text label and/or icon shape.
- **"Start by" dates** auto-derived from due date + effort estimate. With ADHD the due date is often the only date that feels real; this manufactures an earlier one that also feels real.
- Today / Week / Month views, sorted by due date, filterable by course and status
- Daily checklist: recurring items (daily, specific weekdays, every N days), one-tap completion, undoable, resets at local midnight, back-fillable for several prior days. Seed with **medication** and **creatine**.
- **Medication refill counter** — doses remaining, counted down on check-off, warning at ~7 days left
- Gentle completion history (heatmap), informational, never scored

### Phase 2 — Digest + survival features

- **Morning digest at 07:00 America/Toronto**, containing: assignments due within **7 days** (overdue called out first), events within **14 days**, and today's uncompleted checklist items
- Time and both windows configurable; tapping deep-links into Today; a **"send test digest now"** button
- If nothing is due, send a short non-nagging message rather than nothing — silence is indistinguishable from a broken pipeline
- **Exam escalation** — major deadlines get an extra notification at T-1 day, outside the digest
- Optional per-item time-of-day reminders, separate from the digest
- **Low-battery mode.** A toggle collapsing the day to two or three non-negotiables — meds, eat something, one small task — hiding everything else. On bad days a full dashboard is a wall of evidence that you're behind, and that's the day the app stops getting opened. This is a survival feature, not a nice-to-have, which is why it ships this early.

### Phase 3 — Diet tracker

**Input:** I type or paste food in natural language — "2 eggs, 150g chicken breast, a scoop of Revolution Nutrition Hi-Way, 500ml Natrel Plus milk" — and the app parses it into structured items with calories, protein, carbs, and fat.

- Use a free-tier LLM API (Google Gemini's free tier is the leading candidate; Groq is an alternative). State the free-tier limits you believe apply and warn me to verify them. **Abstract the provider behind one swappable module** — the chatbot in Phase 5 uses the same one.
- Force **structured JSON output**, validated before it touches the database. A malformed model response must never corrupt a day's log.
- **Show me the parse before it commits**, per-item quantities and macros editable inline. AI estimates that silently land in my log are worse than no AI at all.
- Mark AI-estimated entries as approximate, visually distinct from exact ones.
- Back the AI with **USDA FoodData Central** and **Open Food Facts**; prefer confident database matches over model guesses.
- **Barcode scanning** via phone camera → Open Food Facts. Faster and more accurate than any model estimate for packaged food.
- **Photo meal logging** via the multimodal model. Same API key, catches meals I'd otherwise skip logging.
- **Saved meals / recipes:** save any combination as a named meal with fixed macros, re-log in **one tap**, scalable by portion. This is the feature I'll use most — make it excellent.
- Recently logged items as one-tap re-log chips.
- **Four macro rings** — calories, protein, carbs, fat — each its own colour, each showing consumed vs. target, **updating in real time** as entries are added, edited, or deleted. Smooth animated fill, no reload, no manual refresh. Over-target reads as informational, not failure. Tapping a ring shows remaining amount and that macro's contributing entries.

**My current targets — seeded defaults, all editable:**

| Macro | Target |
|---|---|
| Calories | 2,900–3,100 kcal |
| Protein | 160–175 g |
| Fat | 70–80 g |
| Carbs | 350–400 g |

These are ranges. Decide with me how a ring represents a range rather than a single number (e.g. a target band) — don't silently collapse them to a midpoint. Changing today's targets must not retroactively rewrite last month's.

- **Bodyweight log**, with weekly average weight plotted against weekly average calories. I'm lean bulking; this is the only real feedback loop on whether the surplus is right.

### Phase 4 — AI leverage

- **Syllabus import.** Point the model at a syllabus PDF and extract every assignment and exam date at once. Manual entry of a semester's deadlines never gets done, and an incomplete calendar is an untrusted calendar.
- **Task breakdown button.** One tap on any assignment turns it into 4–5 concrete first moves. "Write research paper" is paralysis; "open a doc and write three possible thesis sentences" is not.
- **Protein-gap meal suggestion.** At 6pm the app knows I need 62g of protein and 900 calories — surface the saved meals that actually fit.

### Phase 5 — Chatbot

An in-app conversational assistant, using the same swappable LLM module.

- **Read access to my own data** — assignments, events, checklist, food log, macro totals, bodyweight. It should correctly answer "what's due this week", "how much protein do I have left", "what have I been putting off".
- **Write actions** — log food, add an assignment, check off a checklist item, save a meal — always with a confirmation step before anything is written. Never silent writes.
- Persisted conversation history.
- It must say plainly when it doesn't know something or can't do something, rather than inventing an answer. A confidently wrong deadline is worse than no chatbot.
- Be careful with free-tier rate limits — this and the diet parser share a quota. Tell me how you're managing that and what happens when the quota is exhausted.

### Phase 6 — Intelligence

- **"What now?"** — one button, one task, chosen for me based on urgency, time available, and energy. Not a list. Decision paralysis in front of a 14-item list is a real failure mode, and a list-based planner can make it worse.
- **Workload forecast** — sum effort estimates against days remaining and warn before the crunch: "next week has 19 hours of work in 5 days." Colour flags report the fire; this predicts it.
- **Estimated vs. actual time**, with automatic calibration once there's data ("you underestimate by 2.2×").
- **Deferral surfacing** — one-tap "push to tomorrow", no friction, no guilt, but quietly flag tasks that have moved six times. That's not laziness; it's a task that's too vague, too big, or blocked.

### Phase 7 — Extras

Mood/energy check-in (one tap, optional, never scored, never a journaling obligation), doctor-appointment summary export, weekly review digest, subscribable .ics calendar feed, global search, term archiving.

### Explicitly out of scope

Full note-taking, gamification with points and levels, workout tracking, personal finances. Do not add these, and push back if I ask for them mid-build.

---

## Suggested stack

Use this unless you have a concrete reason to deviate, in which case explain it:

- **Frontend:** React + Vite + TypeScript + Tailwind, as a PWA
- **Hosting:** Cloudflare Pages or Vercel (free tier)
- **Backend/DB:** Supabase free tier — Postgres, auth, row-level security, edge functions
- **Scheduled job:** pg_cron or equivalent free scheduler invoking an edge function
- **AI:** free-tier LLM API behind one swappable module, shared by the diet parser and the chatbot
- **Food data:** USDA FoodData Central + Open Food Facts

Flag any free-tier gotchas you know of — inactivity pausing, request caps, egress limits — up front, not after I've built on them.

---

## Deliverable format for each phase

- Working, runnable code — complete files, not fragments or `// ... rest unchanged`
- A short note on what changed and what I need to do (accounts, keys, commands)
- Explicit statement of what is *not* yet working, so I don't go looking for it
- Suggested next phase

Start now with your clarifying questions and any changes you'd make to the phase plan.
