import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { lazyRetry } from '../lib/lazyRetry';
import { Button } from '../components/Button';
import { CachedNotice, LoadFailure } from '../components/LoadFailure';
import { Chip } from '../components/Chip';
import { DotClock } from '../components/DotClock';
import { TickPills } from '../components/TickPills';

/*
 * The sheets load on demand, and are fetched while the browser is idle once
 * the day has painted, so the first tap still opens at once. Bundled eagerly
 * they were most of the reason the first screen's JavaScript ran past its
 * 150 KB budget, for sheets most opens never show.
 */
const loadEditor = () => import('./AssignmentEditor');
const loadChecklistEditor = () => import('./ChecklistEditor');
const loadHistory = () => import('./History');
const loadChecklistSheet = () => import('./ChecklistSheet');
const loadWhatNow = () => import('./WhatNow');
const WhatNow = lazyRetry(loadWhatNow, (m) => m.WhatNow);
const AssignmentEditor = lazyRetry(loadEditor, (m) => m.AssignmentEditor);
const ChecklistEditor = lazyRetry(loadChecklistEditor, (m) => m.ChecklistEditor);
const History = lazyRetry(loadHistory, (m) => m.History);
const ChecklistSheet = lazyRetry(loadChecklistSheet, (m) => m.ChecklistSheet);
/*
 * The widget board is its own chunk: the first screen's JavaScript budget
 * cannot carry twenty widgets, and the rest of Today paints without waiting
 * for it.
 */
const loadBoard = () => import('../components/board/Board');
/* Vision's desk dashboard: its own chunk, fetched only where it is drawn. */
const VisionToday = lazyRetry(() => import('./VisionToday'), (m) => m.VisionToday);
const Board = lazyRetry(loadBoard, (m) => m.Board);
import { LowBattery } from './LowBattery';
import type { ChecklistItem } from '../lib/checklist';
import { useAuth } from '../lib/auth';
import { dueOn } from '../lib/checklist';
import { describeHealth, fetchHealth, type NotificationHealth } from '../lib/health';
import { subscribeOutbox } from '../lib/outbox';
import { adjustedEstimate, calibration } from '../lib/intelligence';
import {
  addAssignment,
  addEvent,
  assignmentDueAt,
  capture,
  completionKey,
  loadCalibrationPairs,
  setActualMinutes,
  completionSet,
  loadToday,
  setAssignmentStatus,
  setCompletion,
  setLowBattery,
  type Assignment,
  type TodayData,
} from '../lib/planner';
import { activeTimezone, detectedTimezone, todayKey, zoneAbbrev, type DayKey } from '../lib/time';
import { applyPending } from '../lib/optimistic';
import { formatRoute } from '../lib/route';
import { moduleOn, usePreferences, type TodaySection } from '../lib/preferences';
import { useOutbox } from '../lib/useOutbox';
import { useNow } from '../lib/useNow';
import { announce } from '../lib/announce';
import { CaptureBox } from '../components/CaptureBox';
import { UndoBar } from '../components/UndoBar';
import { Sheet, SheetPresence } from '../components/Sheet';
import { CompactBar } from '../components/CompactBar';
import { PopMenu } from '../components/PopMenu';
import { askBoard } from '../lib/board';
import { dismissInstallHint, shouldHintInstall } from '../lib/install';
import { onFeedsChanged } from '../lib/feeds';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { useVisionDesk } from '../lib/vision';

/**
 * Today — the default view.
 *
 * Opening the app answers "what do I do right now" without navigation. Since
 * 19 Oct 2026 the widget board gives that answer (what is due next, where to
 * be, the open work with a tick on each row), followed by the two things done
 * here many times a day: capture and the checklist. The full list of
 * everything dated is on Schedule, one tab away and never needed to finish
 * something.
 *
 * The capture box is always visible and always focusable, and it never asks a
 * second question.
 */
export function Today({
  onData,
  refresh = 0,
}: {
  onData?: (d: TodayData) => void;
  /** Bumped by the shell after another screen writes, to re-read in place. */
  refresh?: number;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const prefs = usePreferences();
  const vision = useVisionDesk();
  const [askingTime, setAskingTime] = useState<Assignment | null>(null);
  // The last thing done to a piece of work from this screen (finished, or
  // moved to tomorrow), offered back for a moment.
  const [undoable, setUndoable] = useState<{ message: string; undo: () => void } | null>(null);
  const dismissUndo = useCallback(() => setUndoable(null), []);
  const [pairs, setPairs] = useState<{ estimated: number; actual: number }[]>([]);

  const [loaded, setLoaded] = useState<TodayData | null>(null);
  const [health, setHealth] = useState<NotificationHealth | null>(null);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  // The ⋯ menu, open at the button it was opened from (the title row's, or
  // the compact bar's once the title has scrolled away).
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const [editorFor, setEditorFor] = useState<{ item: ChecklistItem | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // What now, opened from the title row (phones).
  const [askOpen, setAskOpen] = useState(false);
  const titleRow = useRef<HTMLDivElement>(null);
  const [retrying, setRetrying] = useState(false);

  /*
   * Today, recomputed on the minute and whenever the app comes back to the
   * front. It was read once per render, and this screen stays mounted for the
   * life of the app — which on an installed iPhone app can be days. Resumed
   * the next morning it showed yesterday's date, yesterday's labels and
   * yesterday's checklist, and a tick landed on yesterday.
   */
  const now = useNow();
  const today = todayKey(now);

  const reload = useCallback(() => loadToday(today).then(setLoaded), [today]);

  /*
   * What the screen shows: the last read plus every write that has not landed
   * in it yet. See lib/optimistic.ts — this is what makes a tick, a defer or a
   * capture appear the instant it is made, online or not.
   */
  const outbox = useOutbox();
  const data = useMemo(
    () => (loaded ? applyPending(loaded, outbox.writes, today) : null),
    [loaded, outbox.writes, today],
  );

  // Every other screen reads the day through the shell, so it gets the same
  // optimistic view rather than a copy that lags this one.
  useEffect(() => {
    if (data) onData?.(data);
  }, [data, onData]);

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
  }, [reload, refresh]);

  // Once the day is on screen, fetch the sheets in the background.
  const prefetched = useRef(false);
  useEffect(() => {
    if (!loaded || prefetched.current) return;
    prefetched.current = true;
    const fetchAll = () => {
      // A warm-up that fails is not an error: the sheet downloads again when it
      // is opened, and says so if it still cannot (lib/lazyRetry.tsx).
      for (const load of [loadWhatNow, loadEditor, loadChecklistSheet, loadChecklistEditor, loadHistory]) load().catch(() => {});
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(fetchAll, { timeout: 2000 });
    else setTimeout(fetchAll, 600);
  }, [loaded]);

  /*
   * Back after a while away: re-read. The minute clock above only notices a
   * new DAY; a laptop lid closed over lunch would otherwise reopen on whatever
   * was true at noon, including anything changed from the phone meanwhile.
   */
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 2 * 60_000) void reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [reload]);

  // A subscribed calendar changed. Reload in place — NOT via the app's
  // revision key, which remounts this screen and would erase anything
  // half-typed in the capture box every time a meeting moved in Google.
  useEffect(() => onFeedsChanged(() => void reload()), [reload]);

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
  const status = health ? describeHealth(health) : null;

  // The optimistic layer already folds queued ticks into `completions`, so a
  // second tap reads the first one and queues the opposite write — the row
  // and the server can no longer disagree about a double tap.
  const isDone = (itemId: string, day: DayKey) => done.has(completionKey(itemId, day));

  // Today's pills. Other days are filled in from the checklist sheet.
  const pills = dueOn(data?.items ?? [], today);
  const pillsDone = pills.length > 0 && pills.every((i) => isDone(i.id, today));

  async function toggle(itemId: string, day: DayKey) {
    const next = !isDone(itemId, day);
    const label = data?.items.find((i) => i.id === itemId)?.title ?? 'Item';
    announce(next ? `${label} ticked` : `${label} unticked`);
    await setCompletion(userId, itemId, day, next, today);
  }

  function finish(a: Assignment) {
    const finishing = a.status !== 'done';
    void setAssignmentStatus(a.id, finishing ? 'done' : 'todo');
    // Optimistic writes are conveyed entirely by pixels moving, which is
    // silent. The title is included because after a swipe the row may
    // already be gone from the list.
    announce(finishing ? `${a.title} marked done` : `${a.title} reopened`);
    setUndoable(
      finishing
        ? {
            message: `“${a.title}” marked done`,
            undo: () => {
              void setAssignmentStatus(a.id, 'todo');
              announce(`${a.title} reopened`);
            },
          }
        : null,
    );
    // Offered, never demanded. Marking done has to stay free.
    setAskingTime(finishing && a.effort_minutes !== null ? a : null);
  }

  /*
   * How long things actually take, applied. The calibration was measured and
   * shown as a sentence since Phase 6, and `adjustedEstimate` was written and
   * tested — but nothing called it, so the forecast added up raw estimates
   * while the line under it said they usually run twice over, and What now
   * offered a "30 minute" task for a 30 minute gap that history said was an
   * hour. Below five samples the calibration is silent and estimates stand.
   */
  const cal = useMemo(() => calibration(pairs), [pairs]);
  const sized = useCallback((minutes: number | null) => adjustedEstimate(minutes, cal) ?? minutes, [cal]);

  // Reloaded alongside the day, so recording a time updates the calibration
  // without a refresh. Cheap: at most sixty rows of two integers. Keyed on the
  // READ, not the optimistic view, which changes on every tap.
  useEffect(() => {
    void loadCalibrationPairs().then(setPairs);
  }, [loaded]);

  // One root attribute collapses every urgency and course colour to muted
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
        isDone={(id) => isDone(id, today)}
        onToggleItem={(id) => void toggle(id, today)}
      />
    );
  }

  /*
   * Each of Today's sections, by name, so the account's arrangement can place
   * them. Built here rather than inline so the order is data, not layout.
   */
  const assistOn = moduleOn('assist', prefs);
  // What now chooses from open work, so it is offered only when there is some.
  const askable = assistOn && Boolean(data?.assignments.some((a) => a.status !== 'done'));
  const sections: Record<TodaySection, ReactNode> = {
    board: (
      <Suspense fallback={<div aria-hidden className="mx-4 h-48 rounded-hero skeleton-wait" />}>
        <Board
          userId={userId}
          data={data}
          today={today}
          now={now}
          checklist={data ? pills : null}
          isDone={(id) => isDone(id, today)}
          onToggleItem={(id) => void toggle(id, today)}
          onFinish={finish}
          onOpen={setOpenAssignment}
          sized={sized}
          onUndoable={setUndoable}
        />
        {/* Offered after finishing something that carried an estimate,
            from a widget now that the work list lives on Schedule. */}
        {askingTime && (
          <div className="mt-4">
            <HowLong assignment={askingTime} onDone={() => setAskingTime(null)} />
          </div>
        )}
      </Suspense>
    ),
    capture: (
      <CaptureBox
        className=""
        send={(body) => capture(userId, body)}
        courses={data?.courses ?? []}
        addWork={(r) =>
          r.kind === 'work'
            ? addAssignment(userId, {
                title: r.title,
                course_id: r.course?.id ?? null,
                due_at: assignmentDueAt(r.day, r.time),
                due_has_time: Boolean(r.time),
                notes: r.original,
              })
            : addEvent(userId, { title: r.title, kind: r.kind, day: r.day, time: r.time, course_id: r.course?.id ?? null, notes: r.original })
        }
      />
    ),
    checklist: (
        <div>
          {data === null ? (
            // Loading is not empty: no invitation to add while the list is
            // still on its way.
            <div aria-hidden className="tick-pills">
              <span className="tick-pill skeleton-wait w-36" />
              <span className="tick-pill skeleton-wait w-28" />
            </div>
          ) : (
            <TickPills
              items={pills}
              isDone={(id) => isDone(id, today)}
              onToggle={(id) => void toggle(id, today)}
              onOpenList={() => setChecklistOpen(true)}
              onAdd={() => setEditorFor({ item: null })}
            />
          )}
          {/* Said once, for this day, and never compared to any other. A
              moment can be praised safely; a streak cannot. */}
          {pillsDone && <p className="mt-2 px-4 type-note text-t-done">That's everything for today.</p>}
        </div>

    ),
  };
  const shown = prefs.order.filter((id) => !prefs.hidden.includes(id) && sections[id] !== null);

  const menuButton = (
    <button
      type="button"
      className="bar-round"
      aria-label="Today options"
      aria-haspopup="menu"
      aria-expanded={menuAt !== null}
      onClick={(e) => setMenuAt(menuAt ? null : e.currentTarget)}
    >
      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.9" />
        <circle cx="12" cy="12" r="1.9" />
        <circle cx="19" cy="12" r="1.9" />
      </svg>
    </button>
  );

  return (
    <>
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
            className={`type-note ${pull.armed || pull.refreshing ? 'text-accent-2-lit' : 'text-text-low'}`}
          >
            {pull.refreshing ? 'Refreshing' : pull.armed ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}
      {/*
        The large title, as iOS draws one (the iPhone review, 12 Oct 2026):
        the date small above, the weekday large, and the screen's one
        question as a text button on the same line. WHICH day it is is the
        one piece of orientation a planner opens with, so the weekday
        carries the type; "Today" survives as the accessible name. Once it
        scrolls away it folds into the compact bar (CompactBar).

        The zone is said only when the account's differs from the device's:
        travelling is when it matters, and at home it was a word on every
        open that never changed.
      */}
      {vision ? (
        <>
          {data?.cachedAt != null && <CachedNotice at={data.cachedAt} onRetry={() => void retry()} />}
          {data && <LoadFailure failed={data.failed} onRetry={() => void retry()} retrying={retrying} />}
          <Suspense fallback={<div aria-hidden className="h-96 rounded-hero skeleton-wait" />}>
            <VisionToday
              userId={userId}
              data={data}
              today={today}
              now={now}
              pills={pills}
              isDone={(id) => isDone(id, today)}
              onToggleItem={(id) => void toggle(id, today)}
              onFinish={finish}
              onOpen={setOpenAssignment}
              onOpenChecklist={() => setChecklistOpen(true)}
              onAddChecklist={() => setEditorFor({ item: null })}
              sized={sized}
              assistOn={assistOn}
              menu={menuButton}
            />
          </Suspense>
          {askingTime && (
            <div className="mt-4">
              <HowLong assignment={askingTime} onDone={() => setAskingTime(null)} />
            </div>
          )}
          {status?.warn && <p className="mt-3 type-note text-t-critical">{status.text}</p>}
        </>
      ) : (
      <>
      <header className="mb-3 px-4">
        <h1 className="sr-only">Today</h1>
        {prefs.skin === 'nothing' ? (
          /*
            The Dot matrix theme's masthead, after a Nothing OS clock widget:
            the date and What now on a line of mono capitals, the weekday and
            the time on the matrix below. What now moves up rather than
            sharing a line with the clock, which at phone width has room for
            the weekday and the time and nothing else.
          */
          <div ref={titleRow} className="masthead-matrix">
            <div className="flex min-h-[var(--tap)] items-center justify-between gap-3">
              <p className="today-date">
                {monthDay(today)}
                {activeTimezone() !== detectedTimezone() && ` · ${zoneAbbrev()}`}
              </p>
              <div className="flex items-center gap-1">
                {askable && (
                  <button type="button" className="bar-btn md:hidden" aria-expanded={askOpen} onClick={() => setAskOpen(true)}>
                    What now
                  </button>
                )}
                {menuButton}
              </div>
            </div>
            <div className="flex items-end justify-between gap-3">
              <p aria-hidden className="type-masthead min-w-0 text-text-hi">
                {weekdayName(today)}
              </p>
              <DotClock />
            </div>
          </div>
        ) : (
          // Wraps rather than shrinks: a weekday is one word and cannot break, so a
          // squeezed column let "Wednesday" run underneath the buttons.
          <div ref={titleRow} className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <div>
              <p className="today-date">
                {monthDay(today)}
                {activeTimezone() !== detectedTimezone() && ` · ${zoneAbbrev()}`}
              </p>
              <p aria-hidden className="type-masthead text-text-hi">
                {weekdayName(today)}
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {askable && (
                <button type="button" className="bar-btn md:hidden" aria-expanded={askOpen} onClick={() => setAskOpen(true)}>
                  What now
                </button>
              )}
              {menuButton}
            </div>
          </div>
        )}
      </header>

      {/*
        Sits above everything, because it changes what the rest of the screen
        MEANS. A reader who misses this reads a partial day as a whole one.
      */}
      {data?.cachedAt != null && (
        <CachedNotice at={data.cachedAt} onRetry={() => void retry()} />
      )}
      {data && <LoadFailure failed={data.failed} onRetry={() => void retry()} retrying={retrying} />}
      <InstallHint />

      {/*
        Today's sections, in the order the account chose (Settings, Today and
        modules), skipping any it hid; the board and capture are always
        shown. Since 19 Oct 2026 that is the whole screen: the widgets answer
        "what now" and let work be ticked off, capture catches the thought,
        the checklist holds the day's ticks. Everything dated is on Schedule.
        On a tablet or a desk What now sits beside them, already answered.
      */}
      <div className="today-layout">
        <div className="today-main">
          {shown.map((id) => (
            <div key={id} data-section={id} style={{ order: shown.indexOf(id) }}>
              {sections[id]}
            </div>
          ))}
          {/* A delivery problem stays on the screen; the routine "last sent"
              line moved to the ⋯ menu, where it is looked up rather than
              read on every open. */}
          {status?.warn && (
            <p className="px-4 type-note text-t-critical" style={{ order: 99 }}>
              {status.text}
            </p>
          )}
        </div>

        <div className="today-side">
          {/* On a tablet or a desk there is room to answer What now without
              being asked: making a stuck person first decide to ask is the
              decision they were stuck on. On a phone it is the title row's
              button. */}
          {assistOn && (
            <div className="hidden md:block">
              <Suspense fallback={null}>
                <WhatNow
                  alwaysOpen
                  assignments={data?.assignments ?? []}
                  courses={data?.courses ?? []}
                  deferrals={data?.deferrals ?? {}}
                  sized={sized}
                  onOpen={setOpenAssignment}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {/* Suspense inside each condition, never around it: SheetPresence reads
          whether it has children to know whether a sheet is open, and a
          Suspense element is always there. */}
      <SheetPresence>
        {checklistOpen && (
          <Suspense fallback={null}>
            <ChecklistSheet
              items={data?.items ?? []}
              today={today}
              isDone={isDone}
              onToggle={(id, d) => void toggle(id, d)}
              onEdit={(item) => {
                // One sheet at a time: Back always means one thing.
                setChecklistOpen(false);
                setEditorFor({ item });
              }}
              onFillIn={() => {
                setChecklistOpen(false);
                setHistoryOpen(true);
              }}
              onClose={() => setChecklistOpen(false)}
            />
          </Suspense>
        )}
      </SheetPresence>

      <SheetPresence>
        {historyOpen && (
          <Suspense fallback={null}>
            <History
              items={data?.items ?? []}
              completions={data?.completions ?? []}
              userId={userId}
              onClose={() => setHistoryOpen(false)}
            />
          </Suspense>
        )}
      </SheetPresence>

      <SheetPresence>
        {openAssignment && (
          <Suspense fallback={null}>
            <AssignmentEditor
              open
              url={formatRoute({ screen: 'today', open: { kind: 'work', id: openAssignment.id } })}
              assignment={openAssignment}
              courses={data?.courses ?? []}
              subtasks={data?.subtasks ?? []}
              userId={userId}
              onClose={() => setOpenAssignment(null)}
              onSaved={reload}
            />
          </Suspense>
        )}
      </SheetPresence>

      <SheetPresence>
        {editorFor && (
          <Suspense fallback={null}>
            <ChecklistEditor
              open
              item={editorFor.item}
              userId={userId}
              nextSortOrder={(data?.items.length ?? 0) + 1}
              onClose={() => setEditorFor(null)}
              onSaved={reload}
            />
          </Suspense>
        )}
      </SheetPresence>
    </main>
    {/* Outside main: main is transformed while pulling to refresh, and a
        fixed bar inside a transformed parent is fixed to that parent. */}
    <CompactBar title="Today" watch={titleRow}>
      {askable && (
        <button type="button" className="bar-btn md:hidden" aria-expanded={askOpen} onClick={() => setAskOpen(true)}>
          What now
        </button>
      )}
      {menuButton}
    </CompactBar>

    {menuAt && (
      <PopMenu label="Today options" anchor={menuAt} onClose={() => setMenuAt(null)}>
        {(choose) => (
          <>
            {/* The board is the phone's Today; the desk dashboard has none to edit. */}
            {!vision && (
              <>
                <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => askBoard('edit'))}>
                  Edit widgets
                </button>
                <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => askBoard('add'))}>
                  Add a widget
                </button>
              </>
            )}
            <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => setChecklistOpen(true))}>
              Checklist and past days
            </button>
            {moduleOn('lowbattery', prefs) && (
              <>
                <div role="separator" className="pop-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => choose(() => void setLowBattery(userId, true).then(reload))}
                >
                  Low battery
                </button>
              </>
            )}
            {status && (
              <>
                <div role="separator" className="pop-sep" />
                <p className={`pop-label ${status.warn ? 'text-t-critical' : ''}`} role="presentation">
                  {status.text}
                </p>
              </>
            )}
          </>
        )}
      </PopMenu>
    )}
    {/* What now, asked from the title row: a short sheet with the one
        question it asks (how long you have) and its one answer. On a
        tablet or a desk it is already answered beside the work. */}
    <SheetPresence>
      {askOpen && data && (
        <Sheet open title="What now?" onClose={() => setAskOpen(false)}>
          <Suspense fallback={null}>
            <WhatNow
              open
              onClose={() => setAskOpen(false)}
              assignments={data.assignments}
              courses={data.courses}
              deferrals={data.deferrals}
              sized={sized}
              onOpen={(a) => {
                setAskOpen(false);
                setOpenAssignment(a);
              }}
            />
          </Suspense>
        </Sheet>
      )}
    </SheetPresence>
    <UndoBar
      message={undoable?.message ?? null}
      onDismiss={dismissUndo}
      onUndo={() => {
        const u = undoable;
        setUndoable(null);
        u?.undo();
      }}
    />
    </>
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

/** "Oct 4": the masthead's date, beside a weekday that is already written. */
function monthDay(day: DayKey): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/**
 * Add to Home Screen, said once, in Safari on an iPhone (lib/install.ts).
 * Reminders cannot reach a browser tab on iOS, so this is the one place the
 * app asks for anything on its first screen, and it does not ask twice.
 */
function InstallHint() {
  const [show, setShow] = useState(shouldHintInstall);
  if (!show) return null;
  return (
    <section aria-label="Add to Home Screen" className="install-hint mb-3.5">
      <div className="min-w-0 flex-1">
        <p className="install-hint-title">Add Planner to your Home Screen</p>
        <p className="type-note text-text-mid">
          Reminders only reach an iPhone app on the Home Screen. Tap Share, then Add to Home Screen.
        </p>
      </div>
      <button
        type="button"
        className="bar-btn -mr-2 shrink-0"
        onClick={() => {
          dismissInstallHint();
          setShow(false);
        }}
      >
        Hide
      </button>
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
