import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable } from '../components/Pressable';
import { AssignmentRow } from '../components/AssignmentRow';
import { Button } from '../components/Button';
import { SkeletonList } from '../components/Skeleton';
import { CachedNotice, LoadFailure } from '../components/LoadFailure';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { NowNext } from '../components/NowNext';
import { TickPills } from '../components/TickPills';
import { SectionHead } from '../components/SectionHead';

/*
 * The sheets load on demand, and are fetched while the browser is idle once
 * the day has painted, so the first tap still opens at once. Bundled eagerly
 * they were most of the reason the first screen's JavaScript ran past its
 * 150 KB budget, for sheets most opens never show.
 */
const loadEditor = () => import('./AssignmentEditor');
const loadChecklistEditor = () => import('./ChecklistEditor');
const loadTriage = () => import('./Triage');
const loadHistory = () => import('./History');
const loadChecklistSheet = () => import('./ChecklistSheet');
const loadWhatNow = () => import('./WhatNow');
const WhatNow = lazy(() => loadWhatNow().then((m) => ({ default: m.WhatNow })));
const AssignmentEditor = lazy(() => loadEditor().then((m) => ({ default: m.AssignmentEditor })));
const ChecklistEditor = lazy(() => loadChecklistEditor().then((m) => ({ default: m.ChecklistEditor })));
const Triage = lazy(() => loadTriage().then((m) => ({ default: m.Triage })));
const History = lazy(() => loadHistory().then((m) => ({ default: m.History })));
const ChecklistSheet = lazy(() => loadChecklistSheet().then((m) => ({ default: m.ChecklistSheet })));
import { LowBattery } from './LowBattery';
import type { ChecklistItem } from '../lib/checklist';
import { FOLDED_BY_DEFAULT, GROUP_ORDER, groupWork, type GroupId } from '../lib/todayGroups';
import { useAuth } from '../lib/auth';
import { dueOn } from '../lib/checklist';
import { describeHealth, fetchHealth, type NotificationHealth } from '../lib/health';
import { subscribeOutbox } from '../lib/outbox';
import { adjustedEstimate, calibration, forecast, stuckTasks } from '../lib/intelligence';
import { dailySummary } from '../lib/assist';
import {
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
import { activeTimezone, addDays, todayKey, zoneAbbrev, type DayKey } from '../lib/time';
import { applyPending } from '../lib/optimistic';
import { useOutbox } from '../lib/useOutbox';
import { useNow } from '../lib/useNow';
import { announce } from '../lib/announce';
import { closeUp, measureBelow, revealList } from '../lib/motion';
import { CaptureBox } from '../components/CaptureBox';
import { UndoBar } from '../components/UndoBar';
import { usePresence } from '../lib/usePresence';
import { SheetPresence } from '../components/Sheet';
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
  refresh = 0,
}: {
  onData?: (d: TodayData) => void;
  /** Bumped by the shell after another screen writes, to re-read in place. */
  refresh?: number;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [askingTime, setAskingTime] = useState<Assignment | null>(null);
  // The last piece of work finished from this screen, offered back for a moment.
  const [finished, setFinished] = useState<{ id: string; title: string } | null>(null);
  const dismissFinished = useCallback(() => setFinished(null), []);
  const [pairs, setPairs] = useState<{ estimated: number; actual: number }[]>([]);

  const [loaded, setLoaded] = useState<TodayData | null>(null);
  const [health, setHealth] = useState<NotificationHealth | null>(null);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  const [triaging, setTriaging] = useState<InboxItem | null>(null);
  const [editorFor, setEditorFor] = useState<{ item: ChecklistItem | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // What now, opened from the pill on the first group (phones).
  const [askOpen, setAskOpen] = useState(false);
  // Which groups are folded: the reader's choice, kept on this device.
  const [folded, setFolded] = useState<Set<GroupId>>(readFolded);
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
      for (const load of [loadWhatNow, loadEditor, loadChecklistSheet, loadChecklistEditor, loadTriage, loadHistory]) void load();
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
  // Rule 12: finished, deferred or removed work leaves on screen. The data
  // drops it at once; its picture stays until it has animated out.
  const work = usePresence(data?.assignments ?? null, (a) => a.id);
  const inbox = usePresence(data?.inbox ?? null, (e) => e.id, { enter: true });

  /*
   * The work, grouped by when it is due (Late, Today, Tomorrow, This week,
   * Later, No date). Built from the presence list, so a row on its way out
   * stays in its group until it has gone; the groups have presence of their
   * own, so a heading whose last row has left leaves on screen too.
   */
  const grouped = data
    ? groupWork(work.list.map((p) => ({ p, due_at: p.item.due_at })), now, today)
    : null;
  const groupsShown = usePresence(grouped, (g) => g.id, { enter: true });
  // What now? rides on the Today group, or on the first group when nothing
  // is due today.
  const liveGroups = (grouped ?? []).filter((g) => g.items.some((x) => !x.p.leaving));
  const askGroup: GroupId | null =
    liveGroups.find((g) => g.id === 'today')?.id ?? liveGroups[0]?.id ?? null;

  const setWorkList = (el: HTMLDivElement | null) => {
    workList.current = el;
    work.containerRef(el);
    groupsShown.containerRef(el);
  };

  /*
   * Folding a group: everything below it closes up or makes room as a
   * cascade rather than jumping, and the rows of a group being opened come
   * in in order (rule 12).
   */
  const foldFlip = useRef<Map<HTMLElement, number> | null>(null);
  const opened = useRef<GroupId | null>(null);
  function toggleFold(id: GroupId, from: HTMLElement) {
    const group = from.closest<HTMLElement>('.work-group');
    if (group) foldFlip.current = measureBelow(group);
    if (folded.has(id)) opened.current = id;
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFolded(next);
      return next;
    });
  }
  useLayoutEffect(() => {
    if (foldFlip.current) {
      closeUp(foldFlip.current);
      foldFlip.current = null;
    }
    const id = opened.current;
    opened.current = null;
    if (!id) return;
    const rows = document.querySelectorAll<HTMLElement>(`#work-${id} > [data-presence]`);
    if (rows.length > 0) revealList(Array.from(rows));
  }, [folded]);
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
    // The rows, inside their groups.
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.work-group > [id^="work-"] > [data-presence]'));
    const before = seenWork.current;
    seenWork.current = new Set(workIds.split(','));
    const arriving = before ? rows.filter((r) => !before.has(r.dataset.presence ?? '')) : rows;
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
  const status = health ? describeHealth(health) : null;

  // The optimistic layer already folds queued ticks into `completions`, so a
  // second tap reads the first one and queues the opposite write — the row
  // and the server can no longer disagree about a double tap.
  const isDone = (itemId: string, day: DayKey) => done.has(completionKey(itemId, day));

  // Today's pills. Other days are filled in from the checklist sheet.
  const pills = dueOn(data?.items ?? [], today);
  const pillsDone = pills.length > 0 && pills.every((i) => isDone(i.id, today));

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

  async function toggle(itemId: string, day: DayKey) {
    const next = !isDone(itemId, day);
    const label = data?.items.find((i) => i.id === itemId)?.title ?? 'Item';
    announce(next ? `${label} ticked` : `${label} unticked`);
    await setCompletion(userId, itemId, day, next, today);
  }

  function finish(a: Assignment) {
    const finishing = a.status !== 'done';
    if (finishing) work.hint(a.id, 'done');
    void setAssignmentStatus(a.id, finishing ? 'done' : 'todo');
    // Optimistic writes are conveyed entirely by pixels moving, which is
    // silent. The title is included because after a swipe the row may
    // already be gone from the list.
    announce(finishing ? `${a.title} marked done` : `${a.title} reopened`);
    setFinished(finishing ? { id: a.id, title: a.title } : null);
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
            className={`type-caption ${pull.armed || pull.refreshing ? 'text-accent-2-lit' : 'text-text-low'}`}
          >
            {pull.refreshing ? 'Refreshing' : pull.armed ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}
      {/*
        The masthead, on one line: the weekday at display size and the date
        beside it. Stacked, the two were 100 px of a phone's first screen; on
        one line they are 44, and that difference is most of a ticket.

        The weekday carries the type because WHICH day is the one piece of
        orientation a planner opens with. "Today" survives as the accessible
        name, because the landmark still has to announce what screen this is.

        The hairline is ember at low alpha, fading out to the right: the only
        place the brand appears as a rule rather than a fill, closing the
        masthead without a divider that would cut the page in two.
      */}
      <header className="mb-3.5 px-4">
        <h1 className="sr-only">Today</h1>
        <div className="flex items-baseline justify-between gap-3">
          <p aria-hidden className="type-masthead text-text-hi">
            {weekdayName(today)}
          </p>
          <p className="today-date">
            {monthDay(today)} &middot; {zoneAbbrev()}
          </p>
        </div>
        <div aria-hidden className="masthead-rule mt-2.5" />
      </header>

      {/*
        Sits above everything, because it changes what the rest of the screen
        MEANS. A reader who misses this reads a partial day as a whole one.
      */}
      {data?.cachedAt != null && (
        <CachedNotice at={data.cachedAt} onRetry={() => void retry()} />
      )}
      {data && <LoadFailure failed={data.failed} onRetry={() => void retry()} retrying={retrying} />}

      {/*
        The top of the day, in the order a morning is lived: catch the thought,
        tick the daily things, see where to be, read the one sentence the app
        has for you. Tight on purpose (the UI overview): on a 375 x 812 phone,
        what is late and the next thing due today sit above the fold.
      */}
      <div className="today-stack mb-6">
        <CaptureBox className="" send={(body) => capture(userId, body)} />

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

        {data && (
          <NowNext
            events={data.events}
            today={today}
            courseFor={(id) => data.courses.find((c) => c.id === id)}
          />
        )}

        <Briefing dep={loaded} today={today} />
      </div>

      {/*
        Two columns once there is room: the work, and beside it what helps you
        act on it — What now answered without asking, what is coming, and the
        inbox still waiting to be sorted. They stack in that order on a phone.
      */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-8 xl:gap-10">
        <div className="min-w-0">
          <section className="mb-8" aria-labelledby="work-heading">
            <h2 id="work-heading" className="sr-only">
              Work
            </h2>
            {/*
              `data === null` is checked FIRST and separately, because
              `!data?.assignments.length` is also true while the fetch is still
              in flight — so this branch rendered "Nothing due." on every app
              open, for the whole duration of the load. Loading and empty are
              different facts and this screen is where the difference matters.
            */}
            {data === null ? (
              <SkeletonList rows={3} kind="work" />
            ) : !work.list.length ? (
              workCleared ? (
                <p className="enter-fade px-4 py-8 type-body text-t-done">
                  That's all the work due today, done.
                </p>
              ) : (
                <EmptyState>Nothing due.</EmptyState>
              )
            ) : (
              <div ref={setWorkList} className="flex flex-col gap-4">
                {groupsShown.list.map(({ item: g, key, leaving }) => {
                  const isFolded = folded.has(g.id);
                  const live = g.items.filter((x) => !x.p.leaving).length;
                  const asksHere = g.id === askGroup;
                  return (
                    <div key={key} data-presence={key} className="work-group" inert={leaving || undefined}>
                      <div className="work-group-head">
                        <button
                          type="button"
                          className="work-group-toggle"
                          aria-expanded={!isFolded}
                          aria-controls={`work-${g.id}`}
                          onClick={(e) => toggleFold(g.id, e.currentTarget)}
                        >
                          <span className="work-group-title">{g.label}</span>
                          <span key={live} className="section-count" aria-label={`${live} ${live === 1 ? 'item' : 'items'}`}>
                            {live}
                          </span>
                          <svg aria-hidden className="work-group-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        {asksHere && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="lg:hidden"
                            aria-expanded={askOpen}
                            onClick={() => setAskOpen(!askOpen)}
                          >
                            What now?
                          </Button>
                        )}
                      </div>

                      {asksHere && (
                        <div className="lg:hidden">
                          <Suspense fallback={null}>
                          <WhatNow
                            open={askOpen}
                            onClose={() => setAskOpen(false)}
                            assignments={data.assignments}
                            courses={data.courses}
                            deferrals={data.deferrals}
                            sized={sized}
                            onOpen={setOpenAssignment}
                          />
                          </Suspense>
                        </div>
                      )}

                      {/* A heading on its way out has already lost its
                          last row; drawing the old rows again would bring
                          one back for the length of the exit. */}
                      {!isFolded && !leaving && (
                        <div id={`work-${g.id}`} className="flex flex-col gap-2">
                          {g.items.map(({ p: { item: a, key: rowKey, leaving: rowLeaving } }) => (
                            <div key={rowKey} data-presence={rowKey} inert={rowLeaving || undefined}>
                              <AssignmentRow
                                // A row leaving because it was finished shows
                                // itself finished on the way out.
                                assignment={rowLeaving && work.hintOf(rowKey) === 'done' ? { ...a, status: 'done' } : a}
                                progress={subtaskProgress(data.subtasks, a.id)}
                                course={data.courses.find((c) => c.id === a.course_id)}
                                now={now}
                                onToggleDone={() => finish(a)}
                                onDefer={() => {
                                  work.hint(a.id, 'defer');
                                  void deferAssignment(userId, a, addDays(todayKey(), 1));
                                  announce(`${a.title} moved to tomorrow`);
                                }}
                                onOpen={() => setOpenAssignment(a)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {askingTime && <HowLong assignment={askingTime} onDone={() => setAskingTime(null)} />}
        </div>

        <div className="min-w-0">
          {/* On a desk there is room to answer What now without being asked:
              making a stuck person first decide to ask is the decision they
              were stuck on. On a phone it is the pill on the first group. */}
          <div className="hidden lg:block">
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

          <Ahead
            assignments={data?.assignments ?? []}
            deferrals={data?.deferrals ?? {}}
            cal={cal}
            sized={sized}
          />

          <section className="mb-8 flex-1">
            <SectionHead title="Inbox" count={data?.inbox.length || null} />
            {Boolean(data?.inbox.length) && (
              <p className="type-note -mt-2 mb-3 px-4 text-text-low">Tap one to sort it out.</p>
            )}
            {data === null ? null : !inbox.list.length ? (
              inboxCleared ? (
                <p className="enter-fade px-4 py-8 type-body text-t-done">Inbox clear.</p>
              ) : (
                <EmptyState>Capture anything here. Sort it later.</EmptyState>
              )
            ) : (
              <div ref={inbox.containerRef}>
                <Card>
                  {inbox.list.map(({ item: entry, key, leaving }) => (
                    <Pressable
                      className="mat-row gap-3 px-4 py-3"
                      key={key}
                      data-presence={key}
                      inert={leaving || undefined}
                      onClick={() => setTriaging(entry)}
                    >
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 self-start rounded-pill bg-text-low" />
                      <span className="type-quote text-text-hi">{entry.body}</span>
                    </Pressable>
                  ))}
                </Card>
              </div>
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
        {triaging && (
          <Suspense fallback={null}>
            <Triage
              item={triaging}
              courses={data?.courses ?? []}
              userId={userId}
              onClose={() => setTriaging(null)}
              onDone={reload}
            />
          </Suspense>
        )}
      </SheetPresence>

      <SheetPresence>
        {openAssignment && (
          <Suspense fallback={null}>
            <AssignmentEditor
              open
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
    <UndoBar
      message={finished ? `“${finished.title}” marked done` : null}
      onDismiss={dismissFinished}
      onUndo={() => {
        if (!finished) return;
        void setAssignmentStatus(finished.id, 'todo');
        announce(`${finished.title} reopened`);
        setFinished(null);
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

const FOLD_KEY = 'planner.today.folded';

/** Folded groups, as last left on this device; Later and No date at first. */
function readFolded(): Set<GroupId> {
  try {
    const raw = localStorage.getItem(FOLD_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as unknown;
      if (Array.isArray(ids)) return new Set(GROUP_ORDER.filter((g) => ids.includes(g)));
    }
  } catch {
    // Storage refused or a bad value: the defaults are a fine place to be.
  }
  return new Set(FOLDED_BY_DEFAULT);
}

function writeFolded(ids: Set<GroupId>) {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...ids]));
  } catch {
    // Not fatal: the fold holds for this session.
  }
}

function Briefing({ dep, today }: { dep: TodayData | null; today: DayKey }) {
  const cacheKey = `planner.briefing:${today}`;
  /*
   * Today's briefing as last seen on this device, shown from the first frame.
   *
   * It used to render nothing until the model answered and then open with a
   * grid-template-rows animation — 420ms of re-laying-out the whole page,
   * every frame, at the exact moment the screen was being read. With the
   * day's text cached, every open after the first shows it at once and the
   * late answer only replaces it if something changed.
   */
  const [text, setText] = useState(() => readBriefing(cacheKey));
  const [open, setOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const shownAtOpen = useRef(Boolean(text));
  // Opening or closing it moves what is below as a cascade, never a jump.
  const followers = useRef<Map<HTMLElement, number> | null>(null);
  useLayoutEffect(() => {
    if (!followers.current) return;
    closeUp(followers.current);
    followers.current = null;
  }, [open]);

  useEffect(() => {
    setText(readBriefing(cacheKey));
  }, [cacheKey]);

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
      if (!live || !r.ok) return;
      setText(r.summary);
      try {
        if (r.summary) localStorage.setItem(cacheKey, r.summary);
        else localStorage.removeItem(cacheKey);
      } catch {
        // Storage refused: the briefing still shows, it just arrives late
        // next time too.
      }
    });
    return () => {
      live = false;
    };
  }, [dep, cacheKey]);

  /*
   * The first arrival of the day, staged on the compositor. The page lays out
   * once with the card in place; the card fades down into it and everything
   * below starts where it was and slides to where it now belongs — transform
   * only, so no frame of the move re-runs layout. Reduced motion: it simply
   * appears.
   */
  useLayoutEffect(() => {
    const el = section.current;
    if (!text || !el || shownAtOpen.current) return;
    shownAtOpen.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const ease = 'cubic-bezier(0.2, 0, 0, 1)';
    const shift = el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginBottom || '0');
    el.animate(
      [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: ease },
    );
    // Everything after it on the page, not only its siblings: it is the last
    // thing in the top stack, and the work below is what has to make room.
    for (const next of measureBelow(el).keys()) {
      next.animate([{ transform: `translateY(${-shift}px)` }, { transform: 'none' }], {
        duration: 360,
        easing: ease,
      });
    }
  }, [text]);

  if (!text) return null;

  /*
   * One line, and More opens the rest in place (the UI overview). The
   * briefing is written so its first clause is the suggestion — "WeBWorK is
   * due at 3 and the problem set tonight" — so the one line still carries the
   * point, and the six lines it was cost the first screen its work.
   */
  return (
    <section ref={section} aria-label="Briefing">
      <div className="mat brief" data-open={open || undefined}>
        <p className="brief-text">{text}</p>
        <button
          type="button"
          className="brief-more"
          aria-expanded={open}
          onClick={(e) => {
            const card = e.currentTarget.closest('section');
            if (card) followers.current = measureBelow(card);
            setOpen(!open);
          }}
        >
          {open ? 'Less' : 'More'}
        </button>
      </div>
    </section>
  );
}

function readBriefing(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function Ahead({
  assignments,
  deferrals,
  cal,
  sized,
}: {
  assignments: Assignment[];
  deferrals: Record<string, number>;
  cal: ReturnType<typeof calibration>;
  sized: (minutes: number | null) => number | null;
}) {
  const tasks = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: sized(a.effort_minutes),
    status: a.status,
    deferrals: deferrals[a.id] ?? 0,
    weight_percent: a.weight_percent,
  }));

  const ahead = forecast(tasks);
  const stuck = stuckTasks(tasks);

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
