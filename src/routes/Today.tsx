import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Pressable } from '../components/Pressable';
import { AssignmentRow } from '../components/AssignmentRow';
import { Button } from '../components/Button';
import { SkeletonList } from '../components/Skeleton';
import { CachedNotice, LoadFailure } from '../components/LoadFailure';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { NowNext } from '../components/NowNext';
import { SectionHead } from '../components/SectionHead';
import { WhatNow } from './WhatNow';
import { ChecklistEditor } from './ChecklistEditor';
import { AssignmentEditor } from './AssignmentEditor';
import { Triage } from './Triage';
import { History } from './History';
import { LowBattery } from './LowBattery';
import type { ChecklistItem } from '../lib/checklist';
import { useAuth } from '../lib/auth';
import { dueOn, recentDays, refillStatus } from '../lib/checklist';
import { describeHealth, fetchHealth, type NotificationHealth } from '../lib/health';
import { subscribeOutbox } from '../lib/outbox';
import { calibration, forecast, stuckTasks } from '../lib/intelligence';
import { dailySummary } from '../lib/assist';
import {
  BACKFILL_DAYS,
  capture,
  completionKey,
  deferAssignment,
  loadCalibrationPairs,
  setActualMinutes,
  completionSet,
  loadToday,
  setAssignmentStatus,
  subtaskProgress,
  setCompletion,
  setLowBattery,
  type Assignment,
  type InboxItem,
  type TodayData,
} from '../lib/planner';
import { activeTimezone, addDays, formatDay, todayKey, zoneAbbrev, type DayKey } from '../lib/time';
import { announce } from '../lib/announce';
import { revealList } from '../lib/motion';
import { onFeedsChanged } from '../lib/feeds';
import { usePullToRefresh } from '../lib/usePullToRefresh';

/**
 * Today — the default view.
 *
 * Opening the app answers "what do I do right now" without navigation, so the
 * order on this screen is the order of the answer: capture first, because a
 * thought you are holding is the most perishable thing here; then the
 * checklist; then everything else.
 *
 * The capture box is always visible and always focusable, and it never asks a
 * second question.
 */
export function Today({
  onData,
}: {
  onData?: (d: TodayData) => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [askingTime, setAskingTime] = useState<Assignment | null>(null);
  const [pairs, setPairs] = useState<{ estimated: number; actual: number }[]>([]);

  const [data, setData] = useState<TodayData | null>(null);
  const [day, setDay] = useState<DayKey>(todayKey());
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [health, setHealth] = useState<NotificationHealth | null>(null);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  const [triaging, setTriaging] = useState<InboxItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [editorFor, setEditorFor] = useState<{ item: ChecklistItem | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const today = todayKey();
  const reload = useCallback(
    () =>
      loadToday(today).then((d) => {
        setData(d);
        onData?.(d);
      }),
    [today, onData],
  );

  /**
   * Retry is separate from reload so the button can show that it is working.
   * Without it a failed retry looks identical to a tap that did nothing, and
   * the user cannot tell whether the app is trying.
   */
  /*
    Installed to a home screen there is no address bar and so no reload button.
    Without this the only way to force fresh data is to force-quit, which is
    what people actually do — and it costs them the offline cache and anything
    half-typed in the capture box.
  */
  const pull = usePullToRefresh(reload);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await reload();
    } finally {
      setRetrying(false);
    }
  }, [reload]);

  useEffect(() => {
    void reload();
    void fetchHealth().then(setHealth);
  }, [reload]);

  // A subscribed calendar changed. Reload in place — NOT via the app's
  // revision key, which remounts this screen and would erase anything
  // half-typed in the capture box every time a meeting moved in Google.
  useEffect(() => onFeedsChanged(() => void reload()), [reload]);

  /*
   * The work list's entrance.
   *
   * `revealList` has existed in motion.ts since the animation vocabulary was
   * written and nothing had ever called it — the app's one authored list
   * animation, shipped and unreachable, which is the same shape as the model
   * list and the series table before them.
   *
   * This is the right place for it and close to the only one. The craft rule
   * is one authored moment per screen rather than an entrance on every
   * section, and on Today the moment that carries meaning is the work
   * arriving: the list is the answer to the question the screen exists to
   * ask. The checklist above it and the inbox below it stay still, so the eye
   * is led to the answer rather than to the page assembling itself.
   *
   * Keyed on the ids, not on `data`, so a reload that changes nothing does
   * not replay it — an entrance that fires again every time something is
   * ticked off would be an animation happening AT you.
   */
  const workList = useRef<HTMLDivElement>(null);
  const workIds = (data?.assignments ?? []).map((a) => a.id).join(',');
  /*
   * Only what is NEW comes in.
   *
   * This animated every row whenever the set of ids changed — and ticking
   * one thing off, pushing one to tomorrow or capturing something all change
   * it. So each of those taps sent the entire list back to opacity zero and
   * slid it in again: on a phone, the whole column shook every time anything
   * in it was touched. The first load still arrives in order; after that a
   * row that was already on screen never moves, and only an arrival animates.
   */
  const seenWork = useRef<Set<string> | null>(null);
  // Layout effect, not effect: the animation's own from-value is opacity 0,
  // and applying that after paint means the row renders visible for one frame
  // and is then hidden to be faded back in. A flash on the screen whose whole
  // job is to be readable in two seconds.
  useLayoutEffect(() => {
    const root = workList.current;
    if (!root || !workIds) return;
    const rows = Array.from(root.children) as HTMLElement[];
    const before = seenWork.current;
    seenWork.current = new Set(workIds.split(','));
    const arriving = before ? rows.filter((r) => !before.has(r.dataset.row ?? '')) : rows;
    if (arriving.length > 0) revealList(arriving);
  }, [workIds]);

  // The dose counter is maintained by a database trigger, so once queued
  // writes have drained the real numbers have to be re-read rather than
  // guessed at locally.
  const wasBusy = useRef(false);
  useEffect(
    () =>
      subscribeOutbox((s) => {
        const busy = s.pending > 0 || s.syncing;
        if (wasBusy.current && !busy) void reload();
        wasBusy.current = busy;
      }),
    [reload],
  );

  const done = completionSet(data?.completions ?? []);
  const items = dueOn(data?.items ?? [], day);
  const status = health ? describeHealth(health) : null;

  const isDone = (itemId: string) => {
    const key = completionKey(itemId, day);
    // An in-flight tap wins over the last fetched state, so the row never
    // flickers back while the write is still in the queue.
    return pendingToggles.has(key) ? !done.has(key) : done.has(key);
  };

  const allDone = items.length > 0 && items.every((i) => isDone(i.id));

  // Work is only "cleared" if something was actually finished today. Without
  // that check an untouched day and a conquered one would read identically,
  // and the praise would be worthless on both.
  const workCleared =
    (data?.assignments.length ?? 0) === 0 && (data?.completedToday.length ?? 0) > 0;

  // Same distinction for the inbox: an inbox you emptied is not an inbox you
  // never used. Tracked across this session rather than guessed from a count.
  const hadInbox = useRef(false);
  if ((data?.inbox.length ?? 0) > 0) hadInbox.current = true;
  const inboxCleared = hadInbox.current && (data?.inbox.length ?? 0) === 0;

  async function toggle(itemId: string) {
    const key = completionKey(itemId, day);
    const next = !isDone(itemId);

    setPendingToggles((p) => new Set(p).add(key));
    const label = items.find((i) => i.id === itemId)?.title ?? 'Item';
    announce(next ? `${label} ticked` : `${label} unticked`);
    await setCompletion(userId, itemId, day, next, today);
  }

  // Clear optimistic state whenever fresh data lands.
  useEffect(() => {
    setPendingToggles(new Set());
  }, [data]);

  // Reloaded alongside the day, so recording a time updates the calibration
  // without a refresh. Cheap: at most sixty rows of two integers.
  useEffect(() => {
    void loadCalibrationPairs().then(setPairs);
  }, [data]);

  // One root attribute collapses every urgency and macro colour to muted
  // ground. No component below knows the mode exists, which is why it cannot
  // be forgotten when a new screen is added.
  const lowBattery = Boolean(data?.lowBattery);
  useEffect(() => {
    document.documentElement.setAttribute('data-low-battery', String(lowBattery));
  }, [lowBattery]);

  async function exitLowBattery() {
    await setLowBattery(userId, false);
    await reload();
  }

  if (lowBattery && data) {
    return (
      <LowBattery
        data={data}
        onExit={() => void exitLowBattery()}
        onChanged={reload}
        isDone={isDone}
        onToggleItem={(id) => void toggle(id)}
      />
    );
  }

  return (
    <main
      className="page-frame"
      style={{
        transform: pull.pull > 0 ? `translate3d(0, ${pull.pull}px, 0)` : undefined,
        transition: pull.pull === 0 ? 'transform 260ms var(--ease-out)' : 'none',
      }}
    >
      {/*
        Only rendered while the gesture is live, so it never occupies space or
        gets read out at rest. aria-hidden because the reload it triggers is
        already announced by the content changing underneath it.
      */}
      {(pull.pull > 0 || pull.refreshing) && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-8 flex justify-center"
        >
          <span
            className={`type-caption ${pull.armed || pull.refreshing ? 'text-accent-2-lit' : 'text-text-low'}`}
          >
            {pull.refreshing ? 'Refreshing' : pull.armed ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}
      {/*
        The masthead.

        This was the word "Today" at h1 and a grey caption under it, which is
        a label for a screen rather than the top of one. The screen already
        knows it is today — the tab is lit, the content is today's. What it
        was not saying is WHICH day, at a size that registers before you have
        decided to read anything, and that is the one piece of orientation a
        planner opens with.

        So the weekday carries the type now, at display weight with real
        negative tracking, and the date sits under it. "Today" survives as the
        accessible name because the landmark still has to announce what screen
        this is, and because rule 1 is about answering that in two seconds.

        The hairline is ember at low alpha, fading out to the right. It is
        the only place in the app the brand appears as a rule rather than a
        fill, and it is doing structural work — it separates the masthead from
        the day without a full-width divider, which would cut the page in two.
      */}
      <header className="mb-6 px-4">
        <h1 className="sr-only">Today</h1>
        <p aria-hidden className="type-masthead text-text-hi">
          {weekdayName(today)}
        </p>
        <p className="mt-1 type-caption text-text-low">
          {formatDay(today)} &middot; {zoneAbbrev()}
        </p>
        <div aria-hidden className="masthead-rule mt-4" />
      </header>

      {/*
        Sits above everything, because it changes what the rest of the screen
        MEANS. A reader who misses this reads a partial day as a whole one.
      */}
      {data?.cachedAt != null && (
        <CachedNotice at={data.cachedAt} onRetry={() => void retry()} />
      )}
      {data && <LoadFailure failed={data.failed} onRetry={() => void retry()} retrying={retrying} />}

      <CaptureBox userId={userId} onCaptured={reload} />

      {data && (
        <NowNext
          events={data.events}
          today={today}
          courseFor={(id) => data.courses.find((c) => c.id === id)}
        />
      )}

      <Briefing dep={data} />

      {/*
        Two columns once there is room, split by kind rather than by size: the
        left is the day's fixed obligations, the right is the work that moves
        and the things still waiting to be sorted. They stack in that order on
        a phone, which is the order a morning actually happens in.
      */}
      <div className="lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.95fr)] xl:gap-10">
        <div className="min-w-0">
      <section className="mb-8">
        <SectionHead
          title="Checklist"
          aside={
            editing ? (
              <Button variant="quiet" onClick={() => setEditing(false)}>
                Done
              </Button>
            ) : (
              <DayStrip today={today} selected={day} onSelect={setDay} />
            )
          }
        />

        {items.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => setEditorFor({ item: null })}>Add an item</Button>
            }
          >
            Nothing on the checklist yet.
          </EmptyState>
        ) : (
          <Card>
            {items.map((item) => {
              const refill = refillStatus(item);
              return (
                <CheckRow
                  key={item.id}
                  label={item.title}
                  // In edit mode the row opens its settings instead of
                  // ticking. One tap target per row either way — a second
                  // control beside the checkbox would be a 44px target sitting
                  // next to another 44px target, on a phone, at 7am.
                  done={editing ? false : isDone(item.id)}
                  onToggle={() =>
                    editing ? setEditorFor({ item }) : void toggle(item.id)
                  }
                  meta={
                    editing ? (
                      <span className="text-text-mid">Edit</span>
                    ) : refill.label ? (
                      <span className={refill.needsRefill ? 'text-t-critical' : undefined}>
                        {refill.label}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </Card>
        )}

        {/* Said once, for this day, and never compared to any other. A
            moment can be praised safely; a streak cannot, because a streak is
            something that can be taken away and then held against you. */}
        {!editing && allDone && (
          <p className="mt-3 px-4 type-body text-t-done">
            {day === today ? "That's everything for today." : "That's everything for that day."}
          </p>
        )}

        <div className="mt-3 flex gap-3 px-4">
          {!editing && items.length > 0 && (
            <>
              <Button variant="quiet" onClick={() => setEditing(true)}>
                Edit list
              </Button>
              <Button variant="quiet" onClick={() => setHistoryOpen(true)}>
                Fill in a day
              </Button>
            </>
          )}
          {editing && (
            <Button variant="quiet" onClick={() => setEditorFor({ item: null })}>
              Add an item
            </Button>
          )}
        </div>
      </section>

      {historyOpen && (
        <History
          items={data?.items ?? []}
          completions={data?.completions ?? []}
          userId={userId}
          onClose={() => setHistoryOpen(false)}
          onChanged={reload}
        />
      )}

      {triaging && (
        <Triage
          item={triaging}
          courses={data?.courses ?? []}
          userId={userId}
          onClose={() => setTriaging(null)}
          onDone={reload}
        />
      )}

      {openAssignment && (
        <AssignmentEditor
          open
          assignment={openAssignment}
          courses={data?.courses ?? []}
          subtasks={data?.subtasks ?? []}
          userId={userId}
          onClose={() => setOpenAssignment(null)}
          onSaved={reload}
        />
      )}

      {editorFor && (
        <ChecklistEditor
          open
          item={editorFor.item}
          userId={userId}
          nextSortOrder={(data?.items.length ?? 0) + 1}
          onClose={() => setEditorFor(null)}
          onSaved={reload}
        />
      )}
        </div>

        <div className="min-w-0">

      {/*
        Two mounts, one on each side of the breakpoint, rather than one that
        changes behaviour. A single component switching between button and
        panel at lg would have to remount to do it, which throws away the
        chosen time budget mid-resize.
      */}
      <div className="lg:hidden">
        <WhatNow
          assignments={data?.assignments ?? []}
          courses={data?.courses ?? []}
          deferrals={data?.deferrals ?? {}}
          onOpen={setOpenAssignment}
        />
      </div>
      <div className="hidden lg:block">
        <WhatNow
          alwaysOpen
          assignments={data?.assignments ?? []}
          courses={data?.courses ?? []}
          deferrals={data?.deferrals ?? {}}
          onOpen={setOpenAssignment}
        />
      </div>


      {askingTime && <HowLong assignment={askingTime} onDone={() => setAskingTime(null)} />}

      <section className="mb-8">
        <SectionHead title="Work" count={data?.assignments.length || null} />
        {/*
          `data === null` is checked FIRST and separately, because
          `!data?.assignments.length` is also true while the fetch is still in
          flight — so this branch rendered "Nothing due." on every single app
          open, for the whole duration of the load, before any error was
          involved. Loading and empty are different facts and this screen is
          the one place the difference matters most.
        */}
        {data === null ? (
          <SkeletonList rows={3} />
        ) : !data.assignments.length ? (
          workCleared ? (
            <p className="px-4 py-8 type-body text-t-done">
              That's all the work due today, done.
            </p>
          ) : (
            <EmptyState>Nothing due.</EmptyState>
          )
        ) : (
          <div ref={workList} className="flex flex-col gap-2.5">
            {data.assignments.map((a) => (
              <AssignmentRow
                key={a.id}
                assignment={a}
                progress={subtaskProgress(data?.subtasks ?? [], a.id)}
                course={data.courses.find((c) => c.id === a.course_id)}
                onToggleDone={() => {
                  const finishing = a.status !== 'done';
                  void setAssignmentStatus(a.id, finishing ? 'done' : 'todo');
                  // Optimistic writes are conveyed entirely by pixels moving,
                  // which is silent. The title is included because after a
                  // swipe the row may already be gone from the list.
                  announce(finishing ? `${a.title} marked done` : `${a.title} reopened`);
                  // Offered, never demanded. Marking done has to stay free.
                  setAskingTime(finishing && a.effort_minutes !== null ? a : null);
                }}
                onDefer={() => {
                  void deferAssignment(userId, a, addDays(todayKey(), 1));
                  announce(`${a.title} moved to tomorrow`);
                }}
                onOpen={() => setOpenAssignment(a)}
              />
            ))}
          </div>
        )}
      </section>


        </div>

        {/*
          The third column exists only where there is room for it. Below xl it
          closes up and the inbox returns to the bottom of the middle column,
          which is the order a phone should read in.

          It is here at all because out of sight is out of mind: an inbox
          stacked under the work list is an inbox nobody scrolls to, so
          anything captured and not triaged the same day effectively stops
          existing. On a laptop there was 848px of margin to spend on exactly
          that problem.
        */}
        <div className="min-w-0">
      {/*
        Forecast, calibration and stuck work. Already computed since Phase 6
        and already rendered — but in the middle column, under the work list,
        where it competed with the thing it is context FOR. Here it sits beside
        the day instead of below it.
      */}
      <Ahead
        assignments={data?.assignments ?? []}
        deferrals={data?.deferrals ?? {}}
        pairs={pairs}
      />

      <section className="mb-8 flex-1">
        <SectionHead title="Inbox" count={data?.inbox.length || null} />
        {Boolean(data?.inbox.length) && (
          <p className="type-note -mt-2 mb-3 px-4 text-text-low">Tap one to sort it out.</p>
        )}
        {!data?.inbox.length ? (
          inboxCleared ? (
            <p className="px-4 py-8 type-body text-t-done">Inbox clear.</p>
          ) : (
            <EmptyState>Capture anything here. Sort it later.</EmptyState>
          )
        ) : (
          <Card>
            {data.inbox.map((entry) => (
              <Pressable
                className="mat-row gap-3 px-4 py-3"
                key={entry.id}
                onClick={() => setTriaging(entry)}
              >
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 self-start rounded-pill bg-text-low" />
                <span className="type-quote text-text-hi">{entry.body}</span>
              </Pressable>
            ))}
          </Card>
        )}
      </section>

      <div className="mb-8 px-4">
        <Button
          variant="quiet"
          onClick={() => void setLowBattery(userId, true).then(reload)}
        >
          Low battery
        </Button>
      </div>

      {status && (
        <footer className="border-t border-ink-600 px-4 py-4">
          <p className={`type-caption ${status.warn ? 'text-t-critical' : 'text-text-low'}`}>
            {status.text}
          </p>
        </footer>
      )}
        </div>
      </div>

    </main>
  );
}

/**
 * Quick capture — the highest-value feature in the app.
 *
 * Submitting clears the field and keeps focus, so three thoughts in a row cost
 * three taps and no navigation. There is no success message: the thought
 * appearing in the inbox below is the confirmation, and a toast would just be
 * something else to dismiss.
 */
function CaptureBox({ userId, onCaptured }: { userId: string; onCaptured: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;

    setText('');
    input.current?.focus();

    await capture(userId, body);
    onCaptured();
  }

  return (
    <form onSubmit={submit} className="mb-8 px-4">
      <label htmlFor="capture" className="sr-only">
        Capture a thought
      </label>
      {/*
        The largest field in the app, because it is the one used most and in
        the most hurry. A plus inside it says what it does before a word is
        read; the key hint only appears while there is something to send.
      */}
      <div className="relative">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-low"
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M9 3.5v11M3.5 9h11" />
        </svg>
        <input
          id="capture"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture anything"
          autoComplete="off"
          enterKeyHint="done"
          className="well capture-well pl-11 type-body"
        />
        {text.trim() && (
          <span aria-hidden className="kicker pointer-events-none absolute top-1/2 right-4 -translate-y-1/2">
            Enter
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * The back-fill strip.
 *
 * Five days, no further. This is the one place the no-streak-shaming rule is
 * easiest to break: a longer window turns into a record of every day missed.
 * Days carry no completion state and no colour — they are a way to reach
 * yesterday, not a report card.
 */
function DayStrip({
  today,
  selected,
  onSelect,
}: {
  today: DayKey;
  selected: DayKey;
  onSelect: (d: DayKey) => void;
}) {
  const days = recentDays(today, BACKFILL_DAYS);

  return (
    <div className="flex gap-1" role="group" aria-label="Choose a day to fill in">
      {days.map((d) => {
        const isToday = d === today;
        const isSelected = d === selected;
        // UTC, because `d` is a calendar date rather than an instant: the
        // weekday of 2026-08-19 is Wednesday in every timezone, and running it
        // through one only risks an off-by-one at the boundary.
        const weekday = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'UTC',
          weekday: 'narrow',
        }).format(new Date(`${d}T12:00:00Z`));

        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={isSelected}
            aria-label={isToday ? `Today, ${formatDay(d)}` : formatDay(d)}
            className={[
              'fx-depth',
          'flex h-9 w-9 flex-col items-center justify-center rounded-pill type-caption',
              'min-h-0',
              isSelected ? 'bg-ink-600 text-text-hi' : 'text-text-low',
            ].join(' ')}
          >
            {/* The weekday letter, with a dot under today. Spelling out
                "Today" does not fit a 36px target, and the dot reads faster
                anyway. No completion state is shown here — this is a way to
                reach yesterday, not a report card. */}
            <span aria-hidden>{weekday}</span>
            {isToday && (
              <span aria-hidden className="mt-0.5 h-1 w-1 rounded-pill bg-current" />
            )}
          </button>
        );
      })}
    </div>
  );
}


/**
 * What is coming, and what is stuck.
 *
 * Both are quiet by default. The forecast says nothing about a normal week —
 * a banner that is always there is a banner that stops being read — and the
 * stuck notice appears only past the threshold the spec names.
 *
 * The stuck copy diagnoses rather than accuses. "That's not laziness; it's a
 * task that's too vague, too big, or blocked" is the spec's own reading, and
 * it is the difference between a useful flag and rule 3 with extra steps.
 */
/**
 * The briefing at the top of the day.
 *
 * Prose above a screen that is already a list, which only earns its place by
 * doing what a list cannot: saying which thing to touch first. "Worth starting
 * the lab before the laundry" is the whole point; restating the deadlines
 * underneath would be a worse copy of the screen.
 *
 * It renders nothing at all until it has something — no skeleton, no spinner,
 * no "generating…". The screen below is complete and authoritative on its own,
 * and a placeholder at the top of it would make a fast screen feel slow while
 * adding no information.
 *
 * Failures are silent for the same reason. If the model is unreachable or out
 * of quota, the day is still fully readable; an error banner over the top of
 * it would be the app complaining about its own optional feature.
 */
/**
 * The weekday a local day key falls on.
 *
 * Parsed at noon UTC rather than midnight, which is the same trick the week
 * view uses: a DayKey is a calendar date with no zone, and midnight is the
 * one instant a zone offset can push into the previous day.
 */
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function weekdayName(day: DayKey): string {
  return WEEKDAY_NAMES[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

function Briefing({ dep }: { dep: TodayData | null }) {
  const [text, setText] = useState('');

  /*
   * Re-asked whenever the day's data reloads — ticking something off should
   * change the briefing. That is cheap on purpose: the server keys its cache
   * on a fingerprint of the work itself, so a repeat ask costs a query and no
   * model call unless something actually moved.
   *
   * `live` guards the late reply. Two reloads in quick succession would
   * otherwise race, and the slower one wins by arriving last.
   */
  useEffect(() => {
    if (!dep) return;

    let live = true;
    void dailySummary(activeTimezone()).then((r) => {
      if (live && r.ok) setText(r.summary);
    });
    return () => {
      live = false;
    };
  }, [dep]);

  if (!text) return null;

  return (
    <section className="arrive mb-6 px-4">
      {/*
        The one hero surface on the busiest screen in the app. Everything
        else on Today is a `flat` Card — a list of work, a checklist, the
        inbox — because a screen answering "what do I do right now" cannot
        afford to make every row compete for the eye. This is the exception:
        it is the single sentence the app chose to say to you today, and the
        larger radius plus the lifted shadow are what tell the eye that
        before a word of it is read.
      */}
      <Card elevation="hero" className="px-5 py-5">
        <p className="kicker mb-2">Briefing</p>
        <p className="type-body text-text-hi" style={{ fontSize: '1.0625rem' }}>
          {text}
        </p>
      </Card>
    </section>
  );
}

function Ahead({
  assignments,
  deferrals,
  pairs,
}: {
  assignments: Assignment[];
  deferrals: Record<string, number>;
  pairs: { estimated: number; actual: number }[];
}) {
  const tasks = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: a.effort_minutes,
    status: a.status,
    deferrals: deferrals[a.id] ?? 0,
    weight_percent: a.weight_percent,
  }));

  const ahead = forecast(tasks);
  const stuck = stuckTasks(tasks);
  const cal = calibration(pairs);

  if (!ahead.warning && stuck.length === 0 && !cal.summary) return null;

  return (
    <section className="mb-8 flex flex-col gap-3 px-4">
      {ahead.warning && <p className="type-body text-t-approaching">{ahead.warning}</p>}

      {/* Stated as a fact about the estimates, not about the person. It is
          shown here because it is the number that makes the forecast above
          readable: 19 hours of estimates is a different week if they usually
          run to double. */}
      {cal.summary && <p className="type-note text-text-low">{cal.summary}</p>}

      {stuck.map(({ task, note }) => (
        <div key={task.id} className="flex flex-col gap-1">
          <span className="type-body text-text-hi">{task.title}</span>
          <span className="type-note text-text-low">{note}</span>
        </div>
      ))}
    </section>
  );
}

/**
 * How long it actually took, asked once and never again.
 *
 * Appears after finishing something that carried an estimate, and only then.
 * Ignoring it is a normal outcome with no consequence: calibration simply
 * waits, which is better than learning from a number given to dismiss a
 * prompt.
 */
function HowLong({
  assignment,
  onDone,
}: {
  assignment: Assignment;
  onDone: () => void;
}) {
  const estimate = assignment.effort_minutes ?? 60;
  const options = [...new Set([
    Math.max(5, Math.round((estimate * 0.5) / 5) * 5),
    estimate,
    Math.round((estimate * 1.5) / 5) * 5,
    estimate * 2,
  ])].sort((a, b) => a - b);

  const label = (m: number) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`);

  return (
    <div className="mb-8 flex flex-wrap items-center gap-2 px-4">
      <span className="type-note text-text-low">How long did that take?</span>
      {options.map((m) => (
        <Chip key={m} onClick={() => void setActualMinutes(assignment.id, m).then(onDone)}>
          {label(m)}
        </Chip>
      ))}
      <Button variant="quiet" size="sm" onClick={onDone}>
        Skip
      </Button>
    </div>
  );
}
