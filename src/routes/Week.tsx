import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { lazyRetry } from '../lib/lazyRetry';
import { flushSync } from 'react-dom';
import { Button } from '../components/Button';
import { AssignmentRow } from '../components/AssignmentRow';
import { EventRow, EventSlip } from '../components/EventSlip';
import { SectionHead } from '../components/SectionHead';
import { EmptyState } from '../components/EmptyState';
import { CompactBar } from '../components/CompactBar';
import {
  courseVar,
  moveAssignment,
  setAssignmentStatus,
  subtaskProgress,
  type Assignment,
  type Course,
  type TodayData,
} from '../lib/planner';
import { addDays, formatDay, localDayKey, todayKey, type DayKey } from '../lib/time';
import { effortMinutes, groupWeek, type DayGroup } from '../lib/week';
import { WeekStrip, weekTotal } from '../components/WeekStrip';
import { BubbleWeek, LedgerWeek, StyleGlyph, TicketWeek, type StyleProps } from '../components/calendar/WeekStyles';
import { HoursWeek } from '../components/calendar/Hours';
import { CALENDAR_STYLES, readCalendarStyle, writeCalendarStyle, type CalendarStyle } from '../lib/calendarStyle';
import { withTransition } from '../lib/transition';
import { useNow } from '../lib/useNow';
import { SheetPresence } from '../components/Sheet';
import { UndoBar } from '../components/UndoBar';
import { useDragToDay } from '../lib/useDragToDay';
import { useAuth } from '../lib/auth';
import { popClose, popOpen } from '../lib/motion';
import { monthDay, weekdayShort } from '../lib/rowWhen';

// Loaded on the tap: the block arithmetic is not needed to draw the week.
const PlanBlocks = lazyRetry(() => import('./PlanBlocks'), (m) => m.PlanBlocks);

/**
 * Week — seven days at a glance.
 *
 * Today remains the default view; this is for the question "how bad is the
 * next stretch", which is a different question and deserves a different
 * screen rather than a longer Today.
 *
 * Three things are deliberately not just "the next seven days": overdue work
 * is lifted to the top instead of sitting on the day it was due, undated work
 * is kept at the bottom instead of dropped, and anything past the window is
 * counted rather than hidden. All three are ways a week view can quietly stop
 * being the whole picture.
 *
 * One header and one menu (the iPhone review, 12 Oct 2026). The title, the
 * range and the week's load sit on two short lines; Select, Find time, the
 * six styles and the course filter live behind the ⋯ button. Before, four
 * layers of controls (a squeezed header with Select and the style glyphs, a
 * Find time button, a row of course chips) stood between the title and the
 * first day, which began at the bottom of a phone's screen.
 */
const WEEK_DAYS = 7;

export function Week({
  data,
  onOpenAssignment,
  onPlan,
  onChanged,
}: {
  data: TodayData | null;
  onOpenAssignment: (a: Assignment) => void;
  /** Takes you where work is added. Used only by the empty state. */
  onPlan: () => void;
  /** Something was added here (suggested blocks) that the day should re-read. */
  onChanged?: () => void;
}) {
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  // The ⋯ menu, open at the button it was opened from (the title row's, or
  // the compact bar's once the title has scrolled away).
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const titleRow = useRef<HTMLDivElement>(null);

  /*
   * Work dragged to another day (lib/useDragToDay.ts): long-press on a
   * phone, drag with a mouse. The move keeps its time of day, and the undo
   * bar takes it back exactly, deferral record and all.
   */
  const { session } = useAuth();
  const page = useRef<HTMLElement>(null);
  const [moved, setMoved] = useState<{ message: string; undo: () => Promise<void> } | null>(null);
  /*
   * Selecting several pieces of work to move or finish together. While
   * selecting, a tap on a row picks it instead of opening it (or ticking
   * it), and one undo takes the whole batch back.
   */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    const root = page.current;
    if (!root || !selecting) return;
    const onClick = (e: MouseEvent) => {
      const row = (e.target as Element).closest<HTMLElement>('[data-drag-work]');
      if (!row || !root.contains(row)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = row.dataset.dragWork as string;
      setPicked((p) => {
        const next = new Set(p);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    root.addEventListener('click', onClick, true);
    return () => root.removeEventListener('click', onClick, true);
  }, [selecting]);
  // The rows are drawn by six different styles; the mark goes on each one's
  // root, whichever style drew it.
  useLayoutEffect(() => {
    page.current?.querySelectorAll<HTMLElement>('[data-drag-work]').forEach((el) => {
      el.toggleAttribute('data-picked', selecting && picked.has(el.dataset.dragWork as string));
      el.toggleAttribute('data-selecting', selecting);
    });
  });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  async function moveAll(day: DayKey) {
    if (!session) return;
    const chosen = (data?.assignments ?? []).filter((a) => picked.has(a.id));
    const list = chosen.filter((a) => !(a.due_at && localDayKey(new Date(a.due_at)) === day));
    const already = chosen.length - list.length;
    const undos = await Promise.all(list.map((a) => moveAssignment(session.user.id, a, day)));
    stopSelecting();
    if (list.length)
      setMoved({
        message: `${list.length} moved to ${day === todayKey() ? 'today' : formatDay(day)}${already ? `, ${already} already there` : ''}`,
        undo: async () => {
          for (const u of undos) await u();
        },
      });
  }

  async function finishAll() {
    const list = (data?.assignments ?? []).filter((a) => picked.has(a.id) && a.status !== 'done');
    await Promise.all(list.map((a) => setAssignmentStatus(a.id, 'done')));
    stopSelecting();
    if (list.length)
      setMoved({
        message: `${list.length} marked done`,
        undo: async () => {
          await Promise.all(list.map((a) => setAssignmentStatus(a.id, 'todo')));
        },
      });
  }

  useDragToDay(page, (id, day) => {
    const a = data?.assignments.find((x) => x.id === id);
    if (!a || !session) return;
    if (a.due_at && localDayKey(new Date(a.due_at)) === day) return;
    void moveAssignment(session.user.id, a, day).then((undo) =>
      setMoved({ message: `“${a.title}” moved to ${day === todayKey() ? 'today' : formatDay(day)}`, undo }),
    );
  });
  const [style, setStyle] = useState<CalendarStyle>(readCalendarStyle);
  const now = useNow();

  // A cross-fade between two drawings of the same week, where the browser
  // can. flushSync so the new style is on the page before the "after"
  // snapshot is taken, or the transition would fade the old style into itself.
  const changeStyle = (next: CalendarStyle) => {
    if (next === style) return;
    writeCalendarStyle(next);
    withTransition(() => flushSync(() => setStyle(next)));
  };

  const today = todayKey();
  const courses = data?.courses ?? [];

  const grouping = useMemo(() => {
    const keep = <T extends { course_id: string | null }>(rows: T[]) =>
      courseFilter ? rows.filter((r) => r.course_id === courseFilter) : rows;

    return groupWeek(
      keep(data?.assignments ?? []),
      keep(data?.events ?? []),
      today,
      WEEK_DAYS,
    );
  }, [data, courseFilter, today]);

  const courseFor = (id: string | null) => courses.find((c) => c.id === id);
  const progressFor = (id: string) => subtaskProgress(data?.subtasks ?? [], id);
  const toggle = (a: Assignment) =>
    // No reload: the optimistic layer moves the row at once, and Today
    // re-reads when the write lands. Reloading here remounted Today and threw
    // away anything half-typed in its capture box.
    void setAssignmentStatus(a.id, a.status === 'done' ? 'todo' : 'done');

  // The calendar's name earns space only when there is more than one to tell
  // apart. With a single subscribed calendar it is the same word on every row.
  const showSource =
    new Set((data?.events ?? []).map((e) => e.source).filter(Boolean)).size > 1;

  const styleProps: StyleProps = {
    days: grouping.days,
    today,
    now,
    courseFor,
    progressFor,
    onToggle: toggle,
    onOpen: onOpenAssignment,
    showSource,
  };

  const total = weekTotal(grouping.days);
  const filtered = courseFilter ? courseFor(courseFilter) : undefined;

  /** A tap on the strip: that day's section, wherever the style drew it. */
  const jumpTo = (day: string) => {
    // A day in a run of empty days is drawn as part of that run's one line.
    const el =
      document.querySelector<HTMLElement>(`main [data-day="${day}"]`) ??
      document.querySelector<HTMLElement>(`main [data-days~="${day}"]`);
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Clear of the compact bar, which will be showing once the page has
    // moved; zero where it is not drawn (the desk).
    const bar = document.querySelector<HTMLElement>('.compact-bar')?.offsetHeight ?? 0;
    // The window, not scrollIntoView: Chrome dropped a smooth scrollIntoView
    // on these sections without moving at all, so the strip was a row of
    // buttons that did nothing. 12 px of air above the day's heading.
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - bar - 12, behavior: still ? 'auto' : 'smooth' });
  };

  const nothingAtAll =
    grouping.overdue.length === 0 &&
    grouping.undated.length === 0 &&
    grouping.days.every((d) => d.assignments.length === 0 && d.events.length === 0);

  const canSelect = Boolean(data?.assignments.some((a) => a.status !== 'done'));
  const canPlan = Boolean(data?.assignments.some((a) => a.status !== 'done' && a.due_at));
  const listStyle = style === 'list';

  const menuButton = (
    <button
      type="button"
      className="bar-round"
      aria-label="Week options"
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

  /** A list of work with a heading: Overdue, No date. Drawn to match the style. */
  const workList = (title: string, list: Assignment[], note?: string) =>
    listStyle ? (
      <section className="lday mb-6">
        <h2 className="lday-head">
          <span>{title}</span>
          <span className="lday-date">{list.length}</span>
        </h2>
        {note && <p className="type-note mb-1 px-4 text-text-low">{note}</p>}
        <div className="lgroup">
          {list.map((a) => (
            <AssignmentRow
              key={a.id}
              look="list"
              assignment={a}
              progress={progressFor(a.id)}
              course={courseFor(a.course_id)}
              now={now}
              onToggleDone={() => toggle(a)}
              onOpen={() => onOpenAssignment(a)}
            />
          ))}
        </div>
      </section>
    ) : (
      <section className="mb-8">
        <SectionHead title={title} count={list.length} />
        {note && <p className="type-note -mt-2 mb-3 px-4 text-text-low">{note}</p>}
        <div className="flex flex-col gap-2.5">
          {list.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              progress={progressFor(a.id)}
              course={courseFor(a.course_id)}
              onToggleDone={() => toggle(a)}
              onOpen={() => onOpenAssignment(a)}
            />
          ))}
        </div>
      </section>
    );

  return (
    <>
    <main
      ref={page}
      className="page-frame"
      // Room for the selection bar, so the last rows can still be reached.
      style={selecting ? { paddingBottom: 'calc(var(--tab-bar) + env(safe-area-inset-bottom) + 9rem)' } : undefined}
    >
      <header className="mb-1 px-4">
        <div ref={titleRow} className="flex items-end justify-between gap-3">
          <h1 className="page-title">Week</h1>
          {menuButton}
        </div>
        <p className="week-range">
          {rangeLabel(today, grouping.days[WEEK_DAYS - 1].day)}
          {total > 0 && ` · ${total >= 60 ? `${Math.round(total / 6) / 10} h` : `${total} min`} of work`}
          {filtered && ` · ${filtered.code ?? filtered.name} only`}
        </p>
      </header>

      {/* The shape of the week, and the way to move through it. */}
      <div className="mb-4">
        <WeekStrip days={grouping.days} today={today} onJump={jumpTo} />
      </div>

      <SheetPresence>
        {planning && data && (
          <Suspense fallback={null}>
            <PlanBlocks data={data} onClose={() => setPlanning(false)} onAdded={() => onChanged?.()} />
          </Suspense>
        )}
      </SheetPresence>

      {selecting && (
        <div className="bulk-bar enter-fade" role="toolbar" aria-label="Selected work">
          <div className="bulk-top">
            <span className="bulk-count" aria-live="polite">
              {picked.size ? `${picked.size} selected` : 'Tap work to select it'}
            </span>
            <button type="button" className="bar-btn -mr-1" data-tone="quiet" onClick={stopSelecting}>
              Cancel
            </button>
          </div>
          {picked.size > 0 && (
            <div className="bulk-acts">
              <Button variant="quiet" size="sm" onClick={() => void moveAll(addDays(todayKey(), 1))}>
                Tomorrow
              </Button>
              <label className="btn btn-quiet bulk-date">
                Pick a day
                <input
                  type="date"
                  aria-label="Move the selected work to a day"
                  min={todayKey()}
                  onChange={(e) => e.target.value && void moveAll(e.target.value as DayKey)}
                />
              </label>
              <Button variant="primary" size="sm" onClick={() => void finishAll()}>
                Mark done
              </Button>
            </div>
          )}
        </div>
      )}

      <UndoBar
        message={moved?.message ?? null}
        onDismiss={() => setMoved(null)}
        onUndo={() => {
          const m = moved;
          setMoved(null);
          void m?.undo();
        }}
      />

      {nothingAtAll && (
        <EmptyState
          /*
            An invitation, which the copy rules allow — but only because this
            is the SETUP case. An empty week early in a term almost always
            means nothing has been entered yet, not that the week is genuinely
            clear, and the two are indistinguishable from here.
            Today's "Nothing due." deliberately gets no action: an empty day is
            a good state, and offering to fill it would be the app nagging.
          */
          action={
            <Button variant="quiet" size="sm" onClick={onPlan}>
              Add work or a syllabus
            </Button>
          }
        >
          {filtered ? `Nothing for ${filtered.code ?? filtered.name} in the next seven days.` : 'Nothing due in the next seven days.'}
        </EmptyState>
      )}

      {grouping.overdue.length > 0 && workList('Overdue', grouping.overdue)}

      {/* Keyed on the style so the entrance plays for the new drawing. */}
      {!nothingAtAll && (
        <div key={style} className="mb-8">
          {style === 'bubble' ? (
            <BubbleWeek {...styleProps} />
          ) : style === 'hours' ? (
            <HoursWeek {...styleProps} />
          ) : style === 'ticket' ? (
            <TicketWeek {...styleProps} />
          ) : style === 'ledger' ? (
            <LedgerWeek {...styleProps} />
          ) : style === 'rail' ? (
            grouping.days.map((group, i) => (
              <DaySection
                key={group.day}
                group={group}
                isToday={group.day === today}
                isLast={i === grouping.days.length - 1}
                courseFor={courseFor}
                progressFor={progressFor}
                onToggle={toggle}
                onOpen={onOpenAssignment}
              />
            ))
          ) : (
            <ListWeek {...styleProps} />
          )}
        </div>
      )}

      {grouping.undated.length > 0 &&
        workList('No date', grouping.undated, 'Kept here so it is not lost. Give it a date when you know one.')}

      {grouping.laterCount > 0 && (
        <p className="mb-12 px-4 type-note text-text-low">
          {grouping.laterCount} more after this week.
        </p>
      )}
    </main>

    <CompactBar title="Week" watch={titleRow}>
      {menuButton}
    </CompactBar>

    {menuAt && (
      <WeekMenu anchor={menuAt} onClose={() => setMenuAt(null)}>
        {(choose) => (
          <>
            {canSelect && (
              <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => setSelecting(true))}>
                Select
              </button>
            )}
            {canPlan && (
              <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => setPlanning(true))}>
                Find time for this week’s work
              </button>
            )}
            {(canSelect || canPlan) && <div role="separator" className="pop-sep" />}

            <p className="pop-label" role="presentation">
              Style
            </p>
            {CALENDAR_STYLES.map((s) => (
              <button
                type="button"
                key={s.value}
                role="menuitemradio"
                aria-checked={style === s.value}
                title={s.hint}
                className="pop-item"
                onClick={() => choose(() => changeStyle(s.value))}
              >
                <span className="pop-icon">
                  <StyleGlyph style={s.value} />
                </span>
                <span className="pop-text">{s.label}</span>
                <Check on={style === s.value} />
              </button>
            ))}

            {courses.length > 0 && (
              <>
                <div role="separator" className="pop-sep" />
                <p className="pop-label" role="presentation">
                  Show
                </p>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={courseFilter === null}
                  className="pop-item"
                  onClick={() => choose(() => setCourseFilter(null))}
                >
                  <span className="pop-text">All courses</span>
                  <Check on={courseFilter === null} />
                </button>
                {courses.map((c) => {
                  const v = courseVar(c.colour_index);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      role="menuitemradio"
                      aria-checked={courseFilter === c.id}
                      className="pop-item"
                      onClick={() => choose(() => setCourseFilter(c.id))}
                    >
                      <span className="pop-icon">
                        {v && <span aria-hidden data-block className="chip-dot" style={{ '--b': `var(${v}-rgb)` } as CSSProperties} />}
                      </span>
                      <span className="pop-text">{c.code ?? c.name}</span>
                      <Check on={courseFilter === c.id} />
                    </button>
                  );
                })}
              </>
            )}
          </>
        )}
      </WeekMenu>
    )}
    </>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="pop-check">
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </span>
  );
}

/**
 * Week's ⋯ menu: a pull-down under the button it was opened from, as iOS
 * draws one.
 *
 * Closes on a choice, on a tap anywhere else, and on Escape, handing focus
 * back to the button. The arrow keys move through it, as its role promises.
 * `choose` closes first and then acts, so a style change cross-fades the
 * week without the menu caught in the snapshot.
 */
function WeekMenu({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: (choose: (act: () => void) => void) => ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [place] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) };
  });

  const closing = useRef(false);
  const close = async (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    await popClose(menu.current);
    onClose();
    anchor.focus();
    then?.();
  };

  useLayoutEffect(() => {
    popOpen(menu.current, '100% 0%');
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The menu's alone: App's Escape would otherwise also leave for Today.
      e.preventDefault();
      void close();
    };
    // A scroll moves the button away from the menu hanging under it.
    const onScroll = () => void close();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
    // Once, while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <>
      <div aria-hidden className="pop-catcher" onClick={() => void close()} />
      <div
        ref={menu}
        role="menu"
        aria-label="Week options"
        className="pop-menu"
        style={{ top: place.top, right: place.right }}
        onKeyDown={onKeyDown}
      >
        {children((act) => void close(act))}
      </div>
    </>
  );
}

/**
 * The List style: each day a heading and one surface of rows, events and
 * work in the same row shape (the iPhone review, 12 Oct 2026).
 *
 * A run of empty days is said once, in a line, rather than drawn as two or
 * three empty headings. The strip at the top already shows the week's shape,
 * gaps included, so the list below can spend its height on what is in it.
 */
function ListWeek({ days, today, now, courseFor, progressFor, onToggle, onOpen, showSource }: StyleProps) {
  const out: ReactNode[] = [];
  let run: DayKey[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(
      <p key={`empty-${run[0]}`} className="lempty" data-days={run.join(' ')}>
        {emptyRun(run, today)}
      </p>,
    );
    run = [];
  };

  for (const g of days) {
    if (g.assignments.length === 0 && g.events.length === 0) {
      run.push(g.day);
      continue;
    }
    flush();
    const minutes = effortMinutes(g);
    out.push(
      <section key={g.day} data-day={g.day} className="lday" aria-labelledby={`day-${g.day}`}>
        <h2 id={`day-${g.day}`} className="lday-head">
          <span>{dayName(g.day, today)}</span>
          <span className="lday-date">{dayDate(g.day, today)}</span>
          {minutes > 0 && (
            <span className="lday-load">{minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`}</span>
          )}
        </h2>
        <div className="lgroup">
          {g.events.map((e) => (
            <EventRow key={e.id} event={e} course={courseFor(e.course_id)} showSource={showSource} />
          ))}
          {g.assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              look="list"
              dayShown
              assignment={a}
              progress={progressFor(a.id)}
              course={courseFor(a.course_id)}
              now={now}
              onToggleDone={() => onToggle(a)}
              onOpen={() => onOpen(a)}
            />
          ))}
        </div>
      </section>,
    );
  }
  flush();

  return <div className="flex flex-col gap-5">{out}</div>;
}

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Today", "Tomorrow", or the weekday. */
function dayName(day: DayKey, today: DayKey): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return WEEKDAY_LONG[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

/** Beside the name: "Mon 12" when the name is Today or Tomorrow, else "Oct 14". */
function dayDate(day: DayKey, today: DayKey): string {
  if (day === today || day === addDays(today, 1)) return `${weekdayShort(day)} ${Number(day.slice(8, 10))}`;
  return monthDay(day);
}

/** "Fri 16 · nothing scheduled", or "Fri 16 – Sat 17 · nothing scheduled". */
function emptyRun(run: DayKey[], today: DayKey): string {
  const name = (day: DayKey) =>
    day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : `${weekdayShort(day)} ${Number(day.slice(8, 10))}`;
  const span = run.length === 1 ? name(run[0]) : `${name(run[0])} – ${name(run[run.length - 1])}`;
  return `${span} · nothing scheduled`;
}

/**
 * One day, in the Rail style.
 *
 * Empty days are still drawn, because the shape of the week is the
 * information — three empty days followed by four full ones is the thing you
 * came here to see, and collapsing the empty ones hides it.
 */
function DaySection({
  group,
  isToday,
  isLast,
  courseFor,
  progressFor,
  onToggle,
  onOpen,
}: {
  group: DayGroup;
  isToday: boolean;
  /** The rail stops here rather than running on into nothing. */
  isLast: boolean;
  courseFor: (id: string | null) => Course | undefined;
  progressFor: (id: string) => { done: number; total: number } | null;
  onToggle: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
}) {
  const empty = group.assignments.length === 0 && group.events.length === 0;
  const minutes = effortMinutes(group);

  return (
    /*
      A day on a spine, not a section on a stack.

      Week was seven identical heading-plus-card blocks. That tells you what
      is due and hides the thing a list is worst at conveying: that Thursday
      has six hours in it and Friday has none. The forecast bar chart above
      says it numerically; down here the week should be legible as a shape
      while you are actually reading the items.

      The spine does that. Every day occupies the rail whether or not it has
      anything on it, so an empty Friday is a visible gap in a continuous line
      rather than a section that simply is not there — and the eye gets the
      week's rhythm for free while reading it in order.
    */
    <section data-day={group.day} className="relative flex gap-3 px-4">
      <div className="relative flex w-10 shrink-0 flex-col items-center">
        {/*
          The rail, drawn first and absolutely positioned so it runs the FULL
          height of the day — including behind the date above it.

          It was a flex child sitting below the date, which meant it started
          again under each marker and left a gap the height of a label and a
          number between every pair of days. Seven short strokes rather than
          one line, which is the opposite of the point: the rail exists to
          stitch the days into a single week.

          `-top-3`/`-bottom-0` overshoot the section by the parent's gap so
          consecutive days meet with no seam.
        */}
        <span
          aria-hidden
          className={[
            'absolute -top-3 left-1/2 w-px -translate-x-1/2 bg-ink-600',
            // The last day ends the week, so the rail ends with it. Running
            // on past the final marker draws a line to a day that is not in
            // the window — a stub pointing at nothing, which reads as the
            // list having been cut off rather than having finished.
            isLast ? 'h-12' : 'bottom-0',
          ].join(' ')}
        />

        {/*
          The marker sits ON the rail and carries the page's own background,
          so it cuts the line rather than crossing it. That is what makes the
          date read as a station on the week rather than a label beside it.
        */}
        <span className="relative flex flex-col items-center bg-ink-900 pb-2">
          <span
            className={`type-caption leading-none ${isToday ? 'text-text-mid' : 'text-text-low'}`}
          >
            {weekdayCaps(group.day)}
          </span>

          {/*
            Today is a filled ember disc. That is the brand as a FILLED
            SURFACE, which is the one thing the colour law permits it to be —
            it states no status, and the urgency ramp is untouched and still
            doing that job on the rows themselves.
          */}
          <span
            className={[
              'mt-1 grid size-7 place-items-center rounded-pill type-label leading-none',
              isToday ? 'bg-accent text-on-accent' : 'text-text-mid',
            ].join(' ')}
          >
            {Number(group.day.slice(8, 10))}
          </span>
        </span>
      </div>

      <div className="min-w-0 flex-1 pb-6">
        {/*
          The date is on the rail now, so this row carries only the day's
          load. The heading keeps the full date as its accessible text,
          because a screen reader gets no spine.
        */}
        <h2 className="sr-only">
          {isToday ? `Today, ${formatDay(group.day)}` : formatDay(group.day)}
        </h2>

        {empty ? (
          /* A rule at the marker's own height rather than an em dash.
             "Nothing on this day" is a gap in the week, and a gap is better
             drawn than written — it also keeps the rail's rhythm even. */
          <div aria-hidden className="flex h-14 items-center">
            <div className="h-px w-full bg-ink-600 opacity-50" />
          </div>
        ) : (
          <>
            {minutes > 0 && (
              <div className="mb-1 flex justify-end">
                <span className="tag type-caption">
                  {minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {group.events.map((e) => (
                <EventSlip key={e.id} event={e} course={courseFor(e.course_id)} />
              ))}
              {group.assignments.map((a) => (
                <AssignmentRow
                  key={a.id}
                  assignment={a}
                  progress={progressFor(a.id)}
                  course={courseFor(a.course_id)}
                  onToggleDone={() => onToggle(a)}
                  onOpen={() => onOpen(a)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Three-letter weekday for the Rail's markers. Noon UTC, so no zone can shift it. */
const WEEKDAY_CAPS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function weekdayCaps(day: string): string {
  return WEEKDAY_CAPS[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

/** "Oct 12–18", or "Oct 28 – Nov 3" across a month. */
function rangeLabel(from: string, to: string): string {
  const month = (day: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
  const d = (day: string) => Number(day.slice(8, 10));
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${month(from)} ${d(from)}–${d(to)}`
    : `${month(from)} ${d(from)} – ${month(to)} ${d(to)}`;
}
