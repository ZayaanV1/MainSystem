import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Widget } from '../../lib/board';
import type { Assignment, Course, InboxItem, PlannerEvent } from '../../lib/planner';
import { courseVar, loadEvents } from '../../lib/planner';
import type { ChecklistItem } from '../../lib/checklist';
import { urgencyFor } from '../../lib/urgency';
import { whatNow, type Task } from '../../lib/intelligence';
import { buildMonth, monthLabel, shiftMonth, startOfMonth } from '../../lib/month';
import { courseGrades } from '../../lib/grades';
import { elapsedLabel, readSession, startSession, type FocusSession } from '../../lib/focus';
import { goalProgress, type Goal } from '../../lib/goals';
import { photoUrl } from '../../lib/boardPhotos';
import {
  addDays,
  daysBetween,
  daysUntil,
  formatDay,
  formatTime,
  formatTimeRange,
  localDayKey,
  localHourMinute,
  type DayKey,
} from '../../lib/time';
import { safeLink, spotifyEmbed } from './catalogue';

/**
 * Every widget the board can hold, drawn from the account's own data.
 *
 * Each one says honestly which state it is in: still loading, failed to
 * load, nothing there yet, or the thing itself. A widget that rendered
 * "Nothing due" while its data was still on its way would be the
 * clear-day lie the post-launch review found on Today (CLAUDE.md).
 */

export interface Term {
  first: DayKey;
  last: DayKey;
}

export interface WidgetContext {
  userId: string;
  today: DayKey;
  now: Date;
  /** Null while Today's data is loading. */
  assignments: Assignment[] | null;
  events: PlannerEvent[] | null;
  courses: Course[];
  inbox: InboxItem[];
  deferrals: Record<string, number>;
  checklist: ChecklistItem[] | null;
  isDone: (itemId: string) => boolean;
  onToggleItem: (id: string) => void;
  onFinish: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
  sized: (minutes: number | null) => number | null;
  capture: (body: string) => Promise<void>;
  /** Null while loading. */
  goals: Goal[] | null;
  goalsFailed: boolean;
  onGoalStep: (goal: Goal) => void;
  /** Weighted work for marks; null while loading or not asked for. */
  grades: { rows: { course_id: string | null; weight_percent: number | null; grade_percent: number | null }[]; failed: boolean } | null;
  /** Undefined while loading; null when the account has no classes. */
  term: Term | null | undefined;
  assistOn: boolean;
  gradesOn: boolean;
  /** True on the board while editing, and on every gallery preview. */
  still: boolean;
}

/* ------------------------------------------------------------- pieces --- */

function Head({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="bw-head">
      <span className="bw-title">{children}</span>
      {right}
    </div>
  );
}

function Dot({ course }: { course: Course | undefined }) {
  const v = courseVar(course?.colour_index);
  return <i aria-hidden className="bw-dot" style={{ '--cc': v ? `var(${v})` : 'var(--text-low)' } as CSSProperties} />;
}

/** Loading is not empty: a quiet bar, never an invitation or a clear day. */
function Waiting() {
  return (
    <div aria-hidden className="bw-wait">
      <span className="skeleton-wait" />
      <span className="skeleton-wait" />
    </div>
  );
}

function Failed({ what }: { what: string }) {
  return <p className="bw-note">Couldn’t load {what}. Pull down to try again.</p>;
}

function Invite({ children }: { children: ReactNode }) {
  return <div className="bw-invite type-note">{children}</div>;
}

/** Digits stay tabular so a ticking number does not shuffle; colons stay proportional. */
function Clocky({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`bw-num tabular-nums ${className}`}>
      {text.split(':').map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="normal-nums">:</span>}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

function split(ms: number) {
  const t = Math.max(0, ms);
  return { d: Math.floor(t / 86_400_000), h: Math.floor((t % 86_400_000) / 3_600_000), m: Math.floor((t % 3_600_000) / 60_000) };
}

const courseOf = (ctx: WidgetContext, id: string | null) => ctx.courses.find((c) => c.id === id);
const open = (ctx: WidgetContext) =>
  (ctx.assignments ?? [])
    .filter((a) => a.status !== 'done')
    .sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));

/** "Today 11:59 p.m.", "Tomorrow", "Thu 5:00 p.m." — the day in words, the time if it has one. */
function whenText(a: Assignment, ctx: WidgetContext): string {
  if (!a.due_at) return 'No date';
  const due = new Date(a.due_at);
  const day = localDayKey(due);
  const n = daysBetween(ctx.today, day);
  const word = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : formatDay(day).split(',')[0];
  return a.due_has_time ? `${word} ${formatTime(due)}` : n === 0 ? 'Today, end of day' : word;
}

/**
 * What to print after the urgency label without saying the day twice:
 * "Due today" is followed by "3:00 p.m.", not "Today 3:00 p.m.".
 */
function afterLabel(a: Assignment, ctx: WidgetContext): string {
  if (!a.due_at) return '';
  const due = new Date(a.due_at);
  const n = daysBetween(ctx.today, localDayKey(due));
  if (n === 0) return a.due_has_time ? formatTime(due) : 'End of day';
  if (n === 1) return a.due_has_time ? formatTime(due) : '';
  return whenText(a, ctx);
}

/* ------------------------------------------------------------ next due --- */

function Due({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.assignments === null) return <><Head>Next due</Head><Waiting /></>;
  // The next deadline still ahead. Late work is Today's Late group's to
  // show; a countdown that reads 0h 00m for something already past is a
  // number that says nothing.
  const a = open(ctx).find((x) => x.due_at && new Date(x.due_at).getTime() > ctx.now.getTime());
  if (!a) {
    if (w.size === 'peg') return <><span className="bw-num bw-peg-num">0</span><span className="bw-peglbl">due</span></>;
    return <><Head>Next due</Head><div className="bw-grow" /><p className="bw-t2">Nothing with a date is open.</p></>;
  }
  const due = new Date(a.due_at!);
  const left = split(due.getTime() - ctx.now.getTime());
  const u = urgencyFor(due, { now: ctx.now });
  const tone = { color: `var(${u.colourVar})` };
  const big =
    left.d > 0 ? (
      <span className="bw-num tabular-nums">{left.d}<small>d</small> {String(left.h).padStart(2, '0')}<small>h</small></span>
    ) : (
      <span className="bw-num tabular-nums">{left.h}<small>h</small> {String(left.m).padStart(2, '0')}<small>m</small></span>
    );
  if (w.size === 'peg')
    return (
      <>
        <span className="bw-num bw-peg-num tabular-nums">{left.d > 0 ? left.d : left.h}</span>
        <span className="bw-peglbl" style={tone}>{left.d > 0 ? 'days' : 'hours'}</span>
      </>
    );
  if (w.size === 'strip')
    return (
      <>
        <div className="bw-strip-main"><Head>Next due</Head><span className="bw-row-t">{a.title}</span></div>
        <div className="bw-strip-end"><span className="bw-n-m">{big}</span><span className="bw-urg" style={tone}>{u.label}</span></div>
      </>
    );
  const course = courseOf(ctx, a.course_id);
  if (w.size === 's')
    return (
      <>
        <Head>Next due</Head>
        <span className="bw-n-l">{big}</span>
        <div className="bw-grow" />
        <button type="button" className="bw-link bw-t2" onClick={() => ctx.onOpen(a)}>{a.title}</button>
        <span className="bw-meta"><Dot course={course} /><span className="bw-urg" style={tone}>{u.label}</span><span>{afterLabel(a, ctx)}</span></span>
      </>
    );
  const then = open(ctx).filter((x) => x.due_at && x.id !== a.id && new Date(x.due_at).getTime() > due.getTime())[0];
  return (
    <div className="bw-split">
      <div className="bw-col bw-between">
        <Head>Next due</Head>
        <div className="bw-blocks">
          {left.d > 0 && <span><span className="bw-num tabular-nums">{left.d}</span><span className="bw-unit">days</span></span>}
          <span><span className="bw-num tabular-nums">{String(left.h).padStart(2, '0')}</span><span className="bw-unit">hours</span></span>
          <span><span className="bw-num tabular-nums">{String(left.m).padStart(2, '0')}</span><span className="bw-unit">min</span></span>
        </div>
      </div>
      <div className="bw-col bw-end">
        <button type="button" className="bw-link bw-t2" onClick={() => ctx.onOpen(a)}>{a.title}</button>
        <span className="bw-meta"><Dot course={course} /><span>{course?.code ?? course?.name ?? 'No course'}</span></span>
        <span className="bw-meta"><span className="bw-urg" style={tone}>{u.label}</span><span>{afterLabel(a, ctx)}</span></span>
        {then && <span className="bw-meta bw-rule"><span>Then: {then.title}</span></span>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- assignments --- */

function Work({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.assignments === null) return <><Head>Assignments</Head><Waiting /></>;
  const list = open(ctx);
  if (w.size === 's')
    return (
      <>
        <Head>Assignments</Head>
        <span className="bw-baseline"><span className="bw-num bw-n-xl tabular-nums">{list.length}</span><span className="bw-unit">open</span></span>
        <div className="bw-grow" />
        <ul className="bw-rows bw-compact">
          {list.slice(0, 2).map((a) => (
            <li key={a.id} className="bw-meta"><Dot course={courseOf(ctx, a.course_id)} /><span>{a.title}</span></li>
          ))}
        </ul>
      </>
    );
  // Enough to fill the largest size; rows that do not fit whole are hidden by
  // WidgetFrame, so a theme with a taller font shows fewer rather than half.
  const n = 10;
  const wide = w.size === 'm' || w.size === 'l';
  return (
    <>
      <Head right={<span className="bw-unit">{wide ? `${list.length} open` : list.length}</span>}>Assignments</Head>
      {list.length === 0 ? (
        <p className="bw-t2 bw-done">That’s all the open work, done.</p>
      ) : (
        <ul className="bw-rows">
          {list.slice(0, n).map((a) => {
            const u = urgencyFor(a.due_at ? new Date(a.due_at) : null, { now: ctx.now });
            return (
              <li key={a.id} className="bw-row">
                <button type="button" className="bw-tick" aria-pressed="false" aria-label={`Finish ${a.title}`} onClick={() => ctx.onFinish(a)} />
                <button type="button" className="bw-row-main bw-link" onClick={() => ctx.onOpen(a)}>
                  <span className="bw-row-t">{a.title}</span>
                  <span className="bw-meta">
                    <Dot course={courseOf(ctx, a.course_id)} />
                    <span className="bw-urg" style={{ color: `var(${u.colourVar})` }}>{u.label}</span>
                    {w.size === 'l' && <span>{afterLabel(a, ctx)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/* ------------------------------------------------------------ what now --- */

const WINDOWS = [15, 30, 60, 120] as const;

function Now({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  if (!ctx.assistOn) return <><Head>What now?</Head><Invite>What now is switched off in Settings.</Invite></>;
  if (ctx.assignments === null) return <><Head>What now?</Head><Waiting /></>;
  const tasks: Task[] = ctx.assignments.map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: ctx.sized(a.effort_minutes),
    status: a.status,
    deferrals: ctx.deferrals[a.id] ?? 0,
    weight_percent: a.weight_percent,
  }));
  if (!tasks.some((t) => t.status !== 'done')) return <><Head>What now?</Head><div className="bw-grow" /><p className="bw-t2 bw-done">That’s everything for now.</p></>;
  if (minutes === null)
    return (
      <>
        <Head>What now?</Head>
        <div className="bw-grow" />
        <p className="bw-t2">How long do you have?</p>
        <div className="bw-minis">
          {WINDOWS.map((m) => (
            <button key={m} type="button" className="bw-mini" onClick={() => setMinutes(m)}>
              {m === 120 ? '2 h' : `${m} min`}
            </button>
          ))}
        </div>
      </>
    );
  const choice = whatNow(tasks, { minutesAvailable: minutes, now: ctx.now });
  const picked = choice ? ctx.assignments.find((a) => a.id === choice.task.id) : undefined;
  if (!choice || !picked) return <><Head>What now?</Head><p className="bw-t2">Nothing fits that.</p></>;
  return (
    <>
      <Head right={<span className="bw-unit">{minutes === 120 ? '2 h' : `${minutes} min`}</span>}>What now?</Head>
      <button type="button" className="bw-link bw-t2 bw-big-t" onClick={() => ctx.onOpen(picked)}>{picked.title}</button>
      {w.size === 'm' && <p className="bw-why type-note">{choice.because}</p>}
      <div className="bw-grow" />
      <div className="bw-minis">
        <button type="button" className="bw-mini" data-on onClick={() => startSession(picked.id, picked.title)}>
          Start timer
        </button>
        <button type="button" className="bw-mini" onClick={() => setMinutes(null)}>Change time</button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- checklist --- */

function List({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.checklist === null) return <><Head>Daily</Head><Waiting /></>;
  if (ctx.checklist.length === 0) return <><Head>Daily</Head><Invite>Your daily checklist shows here once it has items.</Invite></>;
  const items = ctx.checklist.slice(0, 12);
  const done = ctx.checklist.filter((i) => ctx.isDone(i.id)).length;
  return (
    <>
      <Head>Daily</Head>
      <ul className={`bw-rows bw-compact ${w.size === 'm' ? 'bw-cols' : ''}`}>
        {items.map((i) => {
          const on = ctx.isDone(i.id);
          return (
            <li key={i.id} className={`bw-row bw-center ${on ? 'bw-row-done' : ''}`}>
              <button type="button" className="bw-tick" aria-pressed={on} aria-label={i.title} onClick={() => ctx.onToggleItem(i.id)} />
              <span className="bw-row-t">{i.title}</span>
            </li>
          );
        })}
      </ul>
      <div className="bw-grow" />
      {done === ctx.checklist.length ? (
        <span className="bw-meta bw-done"><span>That’s everything for today.</span></span>
      ) : (
        <span className="bw-meta"><span>{done} of {ctx.checklist.length} done</span></span>
      )}
    </>
  );
}

/* ------------------------------------------------------------- events --- */

/** Timed events still to come or under way, soonest first. */
function upcoming(ctx: WidgetContext): PlannerEvent[] {
  const t = ctx.now.getTime();
  return (ctx.events ?? [])
    .filter((e) => !e.all_day && new Date(e.ends_at ?? e.starts_at).getTime() > t)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

function ClassW({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.events === null) return <><Head>Next class</Head><Waiting /></>;
  const all = upcoming(ctx);
  const classes = all.filter((e) => e.kind === 'class');
  const pool = classes.length ? classes : all;
  const [e, after] = pool;
  const label = classes.length ? 'Next class' : 'Up next';
  if (!e) return <><Head>{label}</Head><Invite>No classes coming up. Add your timetable in Plan.</Invite></>;
  const start = new Date(e.starts_at);
  const live = start.getTime() <= ctx.now.getTime();
  const target = live && e.ends_at ? new Date(e.ends_at) : start;
  const mins = Math.max(0, Math.round((target.getTime() - ctx.now.getTime()) / 60_000));
  const rel = mins >= 120 ? `${Math.round(mins / 60)} h` : `${mins} min`;
  const until = live ? 'until it ends' : 'until it starts';
  const head = live ? 'In class now' : label;
  const course = courseOf(ctx, e.course_id);
  const when = `${daysBetween(ctx.today, localDayKey(start)) === 0 ? '' : `${formatDay(localDayKey(start)).split(',')[0]} `}${formatTimeRange(start, e.ends_at ? new Date(e.ends_at) : null)}`;
  if (w.size === 'strip')
    return (
      <>
        <div className="bw-strip-main"><Head>{head}</Head><span className="bw-row-t">{e.title}{e.location ? `, ${e.location}` : ''}</span></div>
        <div className="bw-strip-end"><span className="bw-num bw-n-m">{rel}</span><span className="bw-unit">{until}</span></div>
      </>
    );
  const block = (
    <>
      <span className="bw-num bw-n-l">{rel}</span>
      <span className="bw-unit">{until}</span>
    </>
  );
  const what = (
    <>
      <span className="bw-t2">{e.title}</span>
      <span className="bw-meta"><Dot course={course} /><span>{[e.location, when].filter(Boolean).join(', ')}</span></span>
    </>
  );
  if (w.size === 's') return <><Head>{head}</Head>{block}<div className="bw-grow" />{what}</>;
  return (
    <div className="bw-split bw-split-even">
      <div className="bw-col"><Head>{head}</Head>{block}<div className="bw-grow" />{what}</div>
      <div className="bw-col bw-end bw-aside">
        {after ? (
          <>
            <span className="bw-unit">After that</span>
            <span className="bw-t2 bw-small-t">{after.title}</span>
            <span className="bw-meta"><Dot course={courseOf(ctx, after.course_id)} /><span>{formatTime(new Date(after.starts_at))}</span></span>
          </>
        ) : (
          <span className="bw-unit">Nothing after</span>
        )}
      </div>
    </div>
  );
}

/** One dated thing on a day, for the calendar widgets. */
interface DayThing {
  key: string;
  title: string;
  at: Date;
  course: Course | undefined;
  exam: boolean;
  work?: Assignment;
}

function thingsByDay(ctx: WidgetContext, events: PlannerEvent[]): Map<DayKey, DayThing[]> {
  const out = new Map<DayKey, DayThing[]>();
  const put = (day: DayKey, t: DayThing) => {
    const list = out.get(day) ?? [];
    list.push(t);
    out.set(day, list);
  };
  for (const a of ctx.assignments ?? []) {
    if (a.status === 'done' || !a.due_at) continue;
    const at = new Date(a.due_at);
    put(localDayKey(at), { key: a.id, title: a.title, at, course: courseOf(ctx, a.course_id), exam: false, work: a });
  }
  for (const e of events) {
    if (e.kind !== 'exam' && e.kind !== 'presentation') continue;
    const at = new Date(e.starts_at);
    put(localDayKey(at), { key: e.id, title: e.title, at, course: courseOf(ctx, e.course_id), exam: true });
  }
  for (const list of out.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

const weekday = (day: DayKey, style: 'narrow' | 'short') =>
  new Intl.DateTimeFormat('en-CA', { weekday: style, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

function Week({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.assignments === null || ctx.events === null) return <><Head>Next 7 days</Head><Waiting /></>;
  const byDay = thingsByDay(ctx, ctx.events);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ctx.today, i));
  const count = days.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);
  const head = <Head right={<span className="bw-unit">{count} due</span>}>Next 7 days</Head>;
  if (w.size === 'tall')
    return (
      <>
        {head}
        <ul className="bw-wkv">
          {days.map((d, i) => {
            const items = byDay.get(d) ?? [];
            return (
              <li key={d} data-today={i === 0 || undefined}>
                <span className="bw-dn"><span className="bw-num">{Number(d.slice(8))}</span><small>{weekday(d, 'short')}</small></span>
                <span className="bw-its">
                  {items.length ? items.slice(0, 2).map((t) => (
                    <span key={t.key}><Dot course={t.course} />{t.exam ? `Exam: ${t.title}` : t.title}</span>
                  )) : <em>Nothing due</em>}
                </span>
              </li>
            );
          })}
        </ul>
      </>
    );
  const strip = (
    <div className="bw-wk">
      {days.map((d, i) => (
        <div key={d} data-today={i === 0 || undefined}>
          <span className="bw-wk-d">{weekday(d, 'narrow')}</span>
          <span className="bw-wk-n bw-num">{Number(d.slice(8))}</span>
          <span className="bw-wk-dots">
            {(byDay.get(d) ?? []).slice(0, 3).map((t) => <Dot key={t.key} course={t.course} />)}
          </span>
        </div>
      ))}
    </div>
  );
  // Medium and large: the strip, then what is due in order, as many rows as
  // fit (WidgetFrame). Medium used to put empty space above the strip.
  const list = days.flatMap((d) => (byDay.get(d) ?? []).map((t) => ({ d, t }))).slice(0, 12);
  return (
    <>
      {head}
      {strip}
      <ul className="bw-wklist">
        {list.length ? list.map(({ d, t }) => (
          <li key={t.key}>
            <span className="bw-unit">{weekday(d, 'short')}</span>
            <span className="bw-meta bw-strong"><Dot course={t.course} /><span>{t.exam ? `Exam: ${t.title}` : t.title}</span></span>
            <span className="bw-unit">{formatTime(t.at)}</span>
          </li>
        )) : <li><span /><span className="bw-meta"><span>Nothing due this week.</span></span></li>}
      </ul>
    </>
  );
}

function Month({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const [anchor, setAnchor] = useState<DayKey>(() => startOfMonth(ctx.today));
  const [sel, setSel] = useState<DayKey>(ctx.today);
  const [extra, setExtra] = useState<PlannerEvent[] | null>(null);
  const home = startOfMonth(ctx.today);
  // Today's events reach sixty days ahead; another month reads its own range.
  useEffect(() => {
    if (anchor === home) {
      setExtra(null);
      return;
    }
    let live = true;
    void loadEvents(anchor, addDays(shiftMonth(anchor, 1), -1)).then((ev) => live && setExtra(ev));
    return () => {
      live = false;
    };
  }, [anchor, home]);
  if (ctx.assignments === null || ctx.events === null) return <><Head>Month</Head><Waiting /></>;
  const events = extra ?? ctx.events;
  const grid = buildMonth(anchor, ctx.assignments, events.filter((e) => e.kind === 'exam' || e.kind === 'presentation'), ctx.today);
  const byDay = thingsByDay(ctx, events);
  const name = monthLabel(anchor);
  const cells = grid.weeks.flat();
  const nInMonth = cells.filter((c) => c.inMonth).reduce((n, c) => n + c.assignments.length + c.events.length, 0);
  const gridEl = (
    <div className="bw-mo" style={{ gridTemplateRows: `auto repeat(${grid.weeks.length}, minmax(0, 1fr))` }}>
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i} className="bw-wd">{x}</span>)}
      {cells.map((c) => {
        const things = byDay.get(c.day) ?? [];
        return (
          <button
            key={c.day}
            type="button"
            className="bw-dy"
            data-out={!c.inMonth || undefined}
            data-today={c.isToday || undefined}
            aria-pressed={c.day === sel}
            aria-label={`${formatDay(c.day)}${things.length ? `, ${things.length} due` : ''}`}
            onClick={() => setSel(c.day)}
          >
            {Number(c.day.slice(8))}
            {things.length > 0 && (
              <span className="bw-dy-dots">{things.slice(0, 3).map((t) => <Dot key={t.key} course={t.course} />)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
  const chosen = byDay.get(sel) ?? [];
  const dayName = sel === ctx.today ? 'Today' : formatDay(sel);
  const selList = (n: number, bare = false) => (
    <ul className={`bw-dlist ${bare ? 'bw-bare' : ''}`}>
      {chosen.length ? chosen.slice(0, n).map((t) => (
        <li key={t.key}>
          <Dot course={t.course} />
          {t.work ? (
            <button type="button" className="bw-link bw-strong" onClick={() => ctx.onOpen(t.work!)}>{t.title}</button>
          ) : (
            <span className="bw-strong">Exam: {t.title}</span>
          )}
          <em>{formatTime(t.at)}</em>
        </li>
      )) : <li><span className="bw-unit">{dayName}: nothing due</span></li>}
    </ul>
  );
  const nav = (
    <span className="bw-mnav">
      <button type="button" aria-label="Previous month" onClick={() => setAnchor(shiftMonth(anchor, -1))}>‹</button>
      <button type="button" aria-label="Next month" onClick={() => setAnchor(shiftMonth(anchor, 1))}>›</button>
    </span>
  );
  if (w.size === 's') return <><Head>{name}</Head>{gridEl}</>;
  if (w.size === 'm')
    return (
      <div className="bw-split bw-split-month">
        <div className="bw-col">
          <span className="bw-mname">{name}</span>
          <span className="bw-unit">{nInMonth} deadlines and exams</span>
          <div className="bw-grow" />
          {selList(2, true)}
        </div>
        {gridEl}
      </div>
    );
  return (
    <>
      <div className="bw-head"><span className="bw-mname">{name}</span>{w.size === 'l' ? nav : <span className="bw-unit">{nInMonth} due</span>}</div>
      {gridEl}
      {selList(3)}
    </>
  );
}

function Exams({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.events === null) return <><Head>Exams</Head><Waiting /></>;
  const exams = upcoming(ctx).filter((e) => e.kind === 'exam');
  if (!exams.length) return <><Head>Exams</Head><div className="bw-grow" /><p className="bw-t2">No exams in the next two months.</p></>;
  const e = exams[0];
  const days = daysUntil(new Date(e.starts_at), ctx.now);
  if (w.size === 's')
    return (
      <>
        <Head>Next exam</Head>
        <span className="bw-baseline"><span className="bw-num bw-n-xl tabular-nums">{days}</span><span className="bw-unit">{days === 1 ? 'day' : 'days'}</span></span>
        <div className="bw-grow" />
        <span className="bw-t2">{e.title}</span>
        <span className="bw-meta"><Dot course={courseOf(ctx, e.course_id)} /><span>{days < 7 ? `${weekday(localDayKey(new Date(e.starts_at)), 'short')} ${formatTime(new Date(e.starts_at))}` : formatDay(localDayKey(new Date(e.starts_at)))}</span></span>
      </>
    );
  return (
    <>
      <Head right={<span className="bw-unit">{exams.length} coming up</span>}>Exams</Head>
      <ul className="bw-rows">
        {exams.slice(0, 3).map((x) => {
          const n = daysUntil(new Date(x.starts_at), ctx.now);
          return (
            <li key={x.id} className="bw-row bw-center">
              <span className="bw-num bw-n-m bw-daycol tabular-nums">{n}<small>d</small></span>
              <span className="bw-row-main">
                <span className="bw-row-t">{x.title}</span>
                <span className="bw-meta"><Dot course={courseOf(ctx, x.course_id)} /><span>{[formatDay(localDayKey(new Date(x.starts_at))), x.location].filter(Boolean).join(', ')}</span></span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------ the day --- */

/** What is left of today: timed events not yet over and today's deadlines, topped up from tomorrow. */
function restOfDay(ctx: WidgetContext, n: number) {
  const t = ctx.now.getTime();
  const rows: { key: string; at: Date; title: string; course: Course | undefined; live?: boolean; due?: boolean; tomorrow?: boolean }[] = [];
  for (const e of ctx.events ?? []) {
    if (e.all_day) continue;
    const s = new Date(e.starts_at);
    const end = new Date(e.ends_at ?? e.starts_at).getTime();
    const day = localDayKey(s);
    if (day === ctx.today && end > t) rows.push({ key: e.id, at: s, title: e.title, course: courseOf(ctx, e.course_id), live: s.getTime() <= t });
  }
  for (const a of open(ctx)) {
    if (a.due_at && localDayKey(new Date(a.due_at)) === ctx.today) rows.push({ key: a.id, at: new Date(a.due_at), title: `Due: ${a.title}`, course: courseOf(ctx, a.course_id), due: true });
  }
  rows.sort((a, b) => a.at.getTime() - b.at.getTime());
  if (rows.length < n) {
    const tomorrow = addDays(ctx.today, 1);
    for (const e of ctx.events ?? []) {
      if (rows.length >= n) break;
      if (!e.all_day && localDayKey(new Date(e.starts_at)) === tomorrow) rows.push({ key: e.id, at: new Date(e.starts_at), title: e.title, course: courseOf(ctx, e.course_id), tomorrow: true });
    }
  }
  return rows.slice(0, n);
}

function DayRows({ ctx, n, stack = false }: { ctx: WidgetContext; n: number; stack?: boolean }) {
  const rows = restOfDay(ctx, n);
  if (!rows.length) return <p className="bw-unit">Nothing else today.</p>;
  // Beside a clock face the column is too narrow for time and title on one
  // line, so the time goes above and the title gets the whole width.
  if (stack)
    return (
      <ul className="bw-rows bw-compact bw-stack">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="bw-meta">
              <Dot course={r.course} />
              <span className="bw-timecol" data-live={r.live || undefined}>{r.tomorrow ? 'Tomorrow' : formatTime(r.at)}</span>
              {r.due && <span className="bw-urg bw-due-tag">Due</span>}
            </span>
            <span className="bw-row-t">{r.title.replace(/^Due: /u, '')}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <ul className="bw-rows bw-compact">
      {rows.map((r) => (
        <li key={r.key} className="bw-row bw-center">
          <span className="bw-timecol" data-live={r.live || undefined}>{r.tomorrow ? 'Tmrw' : formatTime(r.at).replace(/\s?[ap]\.m\./u, '')}</span>
          <Dot course={r.course} />
          <span className="bw-row-t" data-due={r.due || undefined}>{r.title}</span>
        </li>
      ))}
    </ul>
  );
}

function hourOf(d: Date): number {
  const { hour, minute } = localHourMinute(d);
  return hour + minute / 60;
}

function Timeline({ ctx, span, every }: { ctx: WidgetContext; span: number; every: number }) {
  const nh = hourOf(ctx.now);
  const h0 = Math.max(6, Math.min(24 - span, Math.floor(nh) - 1));
  const h1 = h0 + span;
  const pos = (d: Date) => ((hourOf(d) - h0) / span) * 100;
  const todays = (ctx.events ?? []).filter((e) => !e.all_day && localDayKey(new Date(e.starts_at)) === ctx.today);
  const dues = open(ctx).filter((a) => a.due_at && localDayKey(new Date(a.due_at)) === ctx.today);
  const later = dues.filter((a) => hourOf(new Date(a.due_at!)) > h1);
  const hours: number[] = [];
  for (let h = h0; h <= h1; h += every) hours.push(h);
  const label = (h: number) => {
    const d = new Date(ctx.now);
    d.setHours(h % 24, 0, 0, 0);
    return new Intl.DateTimeFormat('en-CA', { hour: 'numeric' }).format(d).replace(/\s?[ap]\.m\./u, (m) => m.trim()[0]);
  };
  return (
    <>
      <div className="bw-tl">
        {hours.map((h) => (
          <div key={h} className="bw-tl-h" style={{ top: `${((h - h0) / span) * 100}%` }}><span>{label(h)}</span></div>
        ))}
        {todays.map((e) => {
          const s = new Date(e.starts_at);
          const a = Math.max(0, pos(s));
          const b = Math.min(100, pos(new Date(e.ends_at ?? s.getTime() + 3_600_000)));
          if (b <= 0 || a >= 100) return null;
          const v = courseVar(courseOf(ctx, e.course_id)?.colour_index);
          return (
            <div key={e.id} className="bw-tl-b" style={{ top: `${a}%`, height: `${Math.max(b - a, 5)}%`, '--cc': v ? `var(${v})` : 'var(--text-low)' } as CSSProperties}>
              <b>{e.title}</b>
              {e.location && <span>{e.location}</span>}
            </div>
          );
        })}
        {dues.filter((a) => !later.includes(a)).map((a) => {
          const p = pos(new Date(a.due_at!));
          if (p < 0) return null;
          return (
            <button key={a.id} type="button" className="bw-tl-due" style={{ top: `${p}%` }} onClick={() => ctx.onOpen(a)}>
              Due: {a.title}
            </button>
          );
        })}
        {nh >= h0 && nh <= h1 && <div className="bw-tl-now" style={{ top: `${pos(ctx.now)}%` }} aria-label="Now" />}
      </div>
      {later[0] && (
        <span className="bw-meta bw-tl-foot"><Dot course={courseOf(ctx, later[0].course_id)} /><span>Later: {later[0].title}, {formatTime(new Date(later[0].due_at!))}</span></span>
      )}
    </>
  );
}

function Agenda({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.events === null || ctx.assignments === null) return <><Head>Today</Head><Waiting /></>;
  const n = (ctx.events ?? []).filter((e) => !e.all_day && localDayKey(new Date(e.starts_at)) === ctx.today).length;
  return (
    <>
      <Head right={<span className="bw-unit">{n === 0 ? 'Nothing timed' : `${n} on`}</span>}>{w.size === 'l' ? formatDay(ctx.today) : 'Today'}</Head>
      <Timeline ctx={ctx} span={w.size === 'l' ? 10 : 9} every={w.size === 'l' ? 1 : 2} />
    </>
  );
}

/* -------------------------------------------------------------- clocks --- */

/** A clock re-renders itself each second; the board around it does not. */
function useSecond(): Date {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Face({ numbers }: { numbers: boolean }) {
  const t = useSecond();
  const { hour, minute } = localHourMinute(t);
  const s = t.getSeconds();
  const m = minute + s / 60;
  const h = (hour % 12) + m / 60;
  const ticks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        const a = (i * 6 * Math.PI) / 180;
        const r1 = major ? 39 : 42;
        return { i, major, x1: 50 + r1 * Math.sin(a), y1: 50 - r1 * Math.cos(a), x2: 50 + 45 * Math.sin(a), y2: 50 - 45 * Math.cos(a) };
      }),
    [],
  );
  return (
    <svg className="bw-face" viewBox="0 0 100 100" role="img" aria-label={`The time is ${formatTime(t)}`}>
      <circle className="bw-face-rim" cx="50" cy="50" r="49" />
      {ticks.map((k) => <line key={k.i} className={k.major ? 'bw-tk bw-tk-h' : 'bw-tk'} x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} />)}
      {numbers && [12, 3, 6, 9].map((v, i) => (
        <text key={v} x={50 + 31 * Math.sin((i * Math.PI) / 2)} y={50 - 31 * Math.cos((i * Math.PI) / 2) + 3} textAnchor="middle">{v}</text>
      ))}
      <line className="bw-hh" x1="50" y1="54" x2="50" y2="27" transform={`rotate(${h * 30} 50 50)`} />
      <line className="bw-mm" x1="50" y1="56" x2="50" y2="13" transform={`rotate(${m * 6} 50 50)`} />
      <line className="bw-ss" x1="50" y1="60" x2="50" y2="9" transform={`rotate(${s * 6} 50 50)`} />
      <circle className="bw-cap" cx="50" cy="50" r="2.4" />
    </svg>
  );
}

/** "2:05" or "14:05", in the account's zone, without the period. */
function shortTime(t: Date): string {
  return formatTime(t).replace(/\s?[ap]\.m\./u, '');
}

/**
 * Each digit is keyed by its value, so only a digit that changes is a new
 * element, and only it plays the turn-over as it mounts.
 */
function Flip({ text }: { text: string }) {
  return (
    <span className="bw-flip" aria-hidden>
      {[...text].map((c, i) => (c === ':' ? <i key={i}>:</i> : <b key={`${i}-${c}`}>{c}</b>))}
    </span>
  );
}

function TimeText({ face, className }: { face: string; className: string }) {
  const t = useSecond();
  const text = shortTime(t);
  if (face === 'flip') return <><Flip text={text} /><span className="sr-only">{formatTime(t)}</span></>;
  return <span className={`bw-num ${className}`} data-face={face}><Clocky text={text} /></span>;
}

function ClockW({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const face = w.opts.face ?? 'analog';
  const next = ctx.events ? upcoming(ctx)[0] : undefined;
  const nextLine = next ? (
    <span className="bw-meta"><Dot course={courseOf(ctx, next.course_id)} /><span>{new Date(next.starts_at).getTime() <= ctx.now.getTime() ? 'Now' : 'Next'}: {next.title}, {formatTime(new Date(next.starts_at))}</span></span>
  ) : null;
  const date = formatDay(ctx.today);
  if (w.size === 'peg') return <><TimeText face={face === 'analog' ? 'digital' : face} className="bw-peg-num" /><span className="bw-peglbl">{date.split(',')[0]}</span></>;
  if (w.size === 'strip')
    return (
      <>
        <TimeText face={face === 'analog' ? 'digital' : face} className="bw-n-l" />
        <div className="bw-strip-main bw-right"><span className="bw-row-t">{date}</span>{nextLine}</div>
      </>
    );
  const dial = face === 'analog' ? <div className="bw-clockbox"><Face numbers={w.size === 'l'} /></div> : <div className="bw-timebox"><TimeText face={face} className={w.size === 'l' ? 'bw-n-xxl' : 'bw-n-l'} /></div>;
  if (w.size === 's') return face === 'analog' ? dial : <><Head>Clock</Head>{dial}<span className="bw-meta"><span>{date}</span></span></>;
  if (w.size === 'm')
    return (
      <div className="bw-split bw-split-face">
        {dial}
        <div className="bw-col"><Head>{date}</Head><TimeText face="digital" className="bw-n-l" />{nextLine}</div>
      </div>
    );
  return <><Head>{date}</Head>{dial}<DayRows ctx={ctx} n={3} /></>;
}

function ClockDay({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.events === null || ctx.assignments === null) return <><Head>Rest of today</Head><Waiting /></>;
  if (w.size === 'm')
    return (
      <div className="bw-split bw-split-face">
        <div className="bw-clockbox"><Face numbers={false} /></div>
        <div className="bw-col"><Head>Rest of today</Head><DayRows ctx={ctx} n={6} stack /></div>
      </div>
    );
  if (w.size === 'tall')
    return (
      <>
        <div className="bw-clockbox bw-clock-half"><Face numbers={false} /></div>
        <TimeText face="digital" className="bw-n-m bw-centered" />
        <span className="bw-meta bw-centered"><span>{formatDay(ctx.today)}</span></span>
        <div className="bw-grow" />
        <DayRows ctx={ctx} n={8} stack />
      </>
    );
  return (
    <>
      <div className="bw-split bw-split-face bw-top-half">
        <div className="bw-clockbox"><Face numbers /></div>
        <div className="bw-col"><Head>{weekday(ctx.today, 'short')}</Head><TimeText face="digital" className="bw-n-xl" /><span className="bw-meta"><span>{formatDay(ctx.today)}</span></span></div>
      </div>
      <Timeline ctx={ctx} span={6} every={1} />
    </>
  );
}

/* ----------------------------------------------------------- countdown --- */

function Count({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const title = w.opts.title?.trim() ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/u.test(w.opts.day ?? '') ? (w.opts.day as DayKey) : null;
  if (!day && w.size === 'peg') return <><span className="bw-peglbl">Countdown</span><span className="bw-peglbl bw-quiet">Set a date</span></>;
  if (!day) return <><Head>Countdown</Head><Invite>Name a date in Edit, like a reading week.</Invite></>;
  const days = Math.max(0, daysBetween(ctx.today, day));
  const name = title || 'Countdown';
  const when = formatDay(day);
  if (w.size === 'peg') return <><span className="bw-num bw-peg-num tabular-nums">{days}</span><span className="bw-peglbl">{name}</span></>;
  if (w.size === 'strip')
    return (
      <>
        <div className="bw-strip-main"><Head>Countdown</Head><span className="bw-row-t">{name}</span></div>
        <div className="bw-strip-end"><span className="bw-num bw-n-l tabular-nums">{days}<small>{days === 1 ? 'day' : 'days'}</small></span><span className="bw-unit">{when}</span></div>
      </>
    );
  if (w.size === 's')
    return (
      <>
        <Head>{name}</Head>
        <div className="bw-grow" />
        <span className="bw-baseline"><span className="bw-num bw-n-xl tabular-nums">{days}</span><span className="bw-unit">{days === 1 ? 'day' : 'days'}</span></span>
        <span className="bw-meta"><span>{days === 0 ? 'Today' : when}</span></span>
      </>
    );
  const weeks = Math.floor(days / 7);
  return (
    <>
      <Head>{name}</Head>
      <div className="bw-grow" />
      <div className="bw-blocks">
        <span><span className="bw-num tabular-nums">{days}</span><span className="bw-unit">{days === 1 ? 'day' : 'days'}</span></span>
        {weeks > 0 && <span><span className="bw-num tabular-nums">{weeks}</span><span className="bw-unit">{weeks === 1 ? 'week' : 'weeks'}</span></span>}
      </div>
      <span className="bw-meta"><span>{when}</span></span>
    </>
  );
}

/* --------------------------------------------------------------- focus --- */

/** The app's one focus timer (lib/focus.ts), shown and started from here. Stopping goes through the bar. */
function useFocusSession(): FocusSession | null {
  const [s, setS] = useState<FocusSession | null>(() => readSession());
  useEffect(() => {
    const id = setInterval(() => setS(readSession()), 1000);
    return () => clearInterval(id);
  }, []);
  return s;
}

function Focus({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const session = useFocusSession();
  const stop = () => window.dispatchEvent(new CustomEvent('planner:focus-stop'));
  if (session) {
    const label = elapsedLabel(session);
    if (w.size === 'peg')
      return (
        <button type="button" className="bw-fill-btn" onClick={stop} aria-label={`Stop the timer on ${session.title}`}>
          <Clocky text={label} className="bw-focus-peg" />
          <span className="bw-peglbl bw-signal">Stop</span>
        </button>
      );
    if (w.size === 'strip')
      return (
        <>
          <div className="bw-strip-main"><Head>Focus</Head><span className="bw-row-t">{session.title}</span></div>
          <Clocky text={label} className="bw-n-l" />
          <button type="button" className="bw-mini" data-on onClick={stop}>Stop</button>
        </>
      );
    return (
      <>
        <Head right={<span className="bw-unit bw-signal">Running</span>}>Focus</Head>
        <div className="bw-grow" />
        <Clocky text={label} className="bw-n-xl" />
        <span className="bw-meta"><span>{session.title}</span></span>
        <div className="bw-minis"><button type="button" className="bw-mini" data-on onClick={stop}>Stop</button></div>
      </>
    );
  }
  if (ctx.assignments === null) return <><Head>Focus</Head><Waiting /></>;
  const tasks: Task[] = ctx.assignments.map((a) => ({
    id: a.id, title: a.title, due_at: a.due_at, effort_minutes: ctx.sized(a.effort_minutes), status: a.status, deferrals: ctx.deferrals[a.id] ?? 0, weight_percent: a.weight_percent,
  }));
  const choice = whatNow(tasks, { now: ctx.now });
  const pick = choice ? ctx.assignments.find((a) => a.id === choice.task.id) : undefined;
  if (!pick) return <><Head>Focus</Head><div className="bw-grow" /><p className="bw-t2 bw-done">Nothing open to time.</p></>;
  const start = () => startSession(pick.id, pick.title);
  if (w.size === 'peg')
    return (
      <button type="button" className="bw-fill-btn" onClick={start} aria-label={`Start the timer on ${pick.title}`}>
        <Clocky text="00:00" className="bw-focus-peg" />
        <span className="bw-peglbl">Start</span>
      </button>
    );
  if (w.size === 'strip')
    return (
      <>
        <div className="bw-strip-main"><Head>Focus</Head><span className="bw-row-t">{pick.title}</span></div>
        <button type="button" className="bw-mini" data-on onClick={start}>Start</button>
      </>
    );
  return (
    <>
      <Head>Focus</Head>
      <div className="bw-grow" />
      <Clocky text="00:00" className="bw-n-l bw-quiet" />
      <span className="bw-meta"><span>Next: {pick.title}</span></span>
      <div className="bw-minis bw-one"><button type="button" className="bw-mini" data-on onClick={start}>Start timer</button></div>
    </>
  );
}

/* ---------------------------------------------------------------- term --- */

function TermW({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.term === undefined) return <><Head>Term</Head><Waiting /></>;
  if (ctx.term === null && w.size === 'peg') return <><span className="bw-peglbl">Term</span><span className="bw-peglbl bw-quiet">Add classes</span></>;
  if (ctx.term === null) return <><Head>Term</Head><Invite>Add your classes in Plan and the term’s weeks appear here.</Invite></>;
  const { first, last } = ctx.term;
  const weeks = Math.max(1, Math.ceil((daysBetween(first, last) + 1) / 7));
  const into = daysBetween(first, ctx.today);
  if (into < 0) {
    const n = -into;
    return <><Head>Term</Head><div className="bw-grow" /><span className="bw-baseline"><span className="bw-num bw-n-xl tabular-nums">{n}</span><span className="bw-unit">{n === 1 ? 'day' : 'days'} to go</span></span><span className="bw-meta"><span>Classes start {formatDay(first)}</span></span></>;
  }
  if (daysBetween(ctx.today, last) < 0) return <><Head>Term</Head><div className="bw-grow" /><p className="bw-t2">Classes ended {formatDay(last)}.</p></>;
  const week = Math.min(weeks, Math.floor(into / 7) + 1);
  const bar = (
    <div className="bw-segbar" aria-hidden>
      {Array.from({ length: weeks }, (_, i) => <i key={i} data-on={i < week - 1 || undefined} data-now={i === week - 1 || undefined} />)}
    </div>
  );
  if (w.size === 'peg') return <><span className="bw-num bw-peg-num">W{week}</span><span className="bw-peglbl">of {weeks}</span></>;
  if (w.size === 'strip')
    return (
      <>
        <div className="bw-strip-main bw-nogrow"><Head>Term</Head><span className="bw-row-t">Week {week} of {weeks}</span></div>
        <div className="bw-strip-fill">{bar}</div>
      </>
    );
  return (
    <>
      <Head>Term</Head>
      <span className="bw-baseline"><span className="bw-num bw-n-xl tabular-nums">{week}</span><span className="bw-unit">of {weeks} weeks</span></span>
      <div className="bw-grow" />
      {bar}
      <span className="bw-meta"><span>Classes end {formatDay(last)}</span></span>
    </>
  );
}

/* ---------------------------------------------------------------- goal --- */

function GoalW({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (ctx.goals === null) return <><Head>Goal</Head><Waiting /></>;
  if (ctx.goalsFailed) return <><Head>Goal</Head><Failed what="your goals" /></>;
  const goal = ctx.goals.find((g) => g.id === w.opts.goal);
  if (!goal && w.size === 'peg') return <><span className="bw-peglbl">Goal</span><span className="bw-peglbl bw-quiet">Set a goal</span></>;
  if (!goal) return <><Head>Goal</Head><Invite>Set a goal in Edit: a number to reach by a date.</Invite></>;
  const p = goalProgress(goal, ctx.today);
  const bar = p.segments ? (
    <div className="bw-segbar" aria-hidden>{p.segments.map((on, i) => <i key={i} data-on={on || undefined} />)}</div>
  ) : (
    <div className="bw-fillbar" aria-hidden><i style={{ width: `${p.share * 100}%` }} /></div>
  );
  const step = (
    <button
      type="button"
      className="bw-inc"
      disabled={p.reached}
      aria-label={`Add one to ${goal.title}, now ${goal.have} of ${goal.target}`}
      onClick={() => ctx.onGoalStep(goal)}
    >
      +
    </button>
  );
  const by = goal.by_day ? `By ${formatDay(goal.by_day)}` : null;
  if (w.size === 'peg')
    return (
      <>
        <span className="bw-num bw-peg-num tabular-nums">{goal.have}<small>/{goal.target}</small></span>
        <span className="bw-peglbl">{goal.unit || goal.title}</span>
        <div className="bw-fillbar bw-peg-bar" aria-hidden><i style={{ width: `${p.share * 100}%` }} /></div>
      </>
    );
  const count = (
    <span className="bw-baseline">
      <span className="bw-num bw-n-xl tabular-nums">{goal.have}</span>
      <span className="bw-unit">of {goal.target}{goal.unit ? ` ${goal.unit}` : ''}</span>
    </span>
  );
  if (w.size === 's')
    return (
      <>
        <Head>{goal.title}</Head>
        {count}
        <div className="bw-grow" />
        {bar}
        <span className="bw-meta bw-meta-end">{p.reached ? <span className="bw-done">Reached</span> : <span>{by ?? `${p.left} to go`}</span>}{step}</span>
      </>
    );
  return (
    <>
      <Head right={step}>{goal.title}</Head>
      {count}
      <div className="bw-grow" />
      {bar}
      <span className="bw-meta">
        {p.reached ? <span className="bw-done">Reached. Nicely done.</span> : <span>{p.left} to go{p.daysLeft !== null ? `, ${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left` : ''}</span>}
        {by && <span className="bw-push">{by}</span>}
      </span>
    </>
  );
}

/* --------------------------------------------------------------- marks --- */

function Grades({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  if (!ctx.gradesOn) return <><Head>Marks so far</Head><Invite>Grades are switched off in Settings.</Invite></>;
  if (ctx.grades === null) return <><Head>Marks so far</Head><Waiting /></>;
  if (ctx.grades.failed) return <><Head>Marks so far</Head><Failed what="your marks" /></>;
  const per = ctx.courses
    .filter((c) => !c.archived)
    .map((c) => ({ c, g: courseGrades(ctx.grades!.rows.filter((r) => r.course_id === c.id)) }))
    .filter(({ g }) => !g.empty && g.weightMarked > 0);
  if (!per.length) return <><Head>Marks so far</Head><Invite>Marks appear here once marked work has a weight.</Invite></>;
  // The running mark on what has been marked, and how much has been: two
  // facts with the arithmetic in view, never a projection of the final.
  const running = (g: ReturnType<typeof courseGrades>) => Math.round((g.earned / g.weightMarked) * 1000) / 10;
  if (w.size === 's')
    return (
      <>
        <Head>Marks so far</Head>
        <ul className="bw-rows bw-compact">
          {per.slice(0, 4).map(({ c, g }) => (
            <li key={c.id} className="bw-row bw-center">
              <Dot course={c} />
              <span className="bw-row-t bw-flex">{c.code ?? c.name}</span>
              <span className="bw-num bw-mark tabular-nums">{running(g)}<small>%</small></span>
            </li>
          ))}
        </ul>
      </>
    );
  return (
    <>
      <Head right={<span className="bw-unit">On marked work</span>}>Marks so far</Head>
      <ul className="bw-rows bw-compact bw-marks">
        {per.slice(0, 5).map(({ c, g }) => (
          <li key={c.id}>
            <span className="bw-meta bw-strong"><Dot course={c} /><span>{c.code ?? c.name}</span></span>
            <span className="bw-unit bw-trunc">{`${g.weightMarked}% marked`}</span>
            <span className="bw-num bw-mark tabular-nums">{running(g)}<small>%</small></span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------- capture --- */

function Capture({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const form = (
    <form
      className="bw-capf"
      onSubmit={(e) => {
        e.preventDefault();
        const body = text.trim();
        if (!body) return;
        setText('');
        setSaved(true);
        void ctx.capture(body);
        setTimeout(() => setSaved(false), 1800);
      }}
    >
      <input
        className="well bw-capin"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Capture a thought"
        aria-label="Capture a thought"
        enterKeyHint="done"
        autoComplete="off"
        disabled={ctx.still}
      />
      <button type="submit" className="bw-mini" data-on disabled={!text.trim()}>Add</button>
    </form>
  );
  if (w.size === 'strip') return form;
  return (
    <>
      <Head right={<span className="bw-unit">{ctx.inbox.length} in inbox</span>}>Capture</Head>
      {form}
      <div className="bw-grow" />
      {saved ? (
        <span className="bw-meta bw-done" role="status"><span>Saved to your inbox.</span></span>
      ) : (
        <ul className="bw-rows bw-compact">
          {ctx.inbox.slice(0, 2).map((i) => <li key={i.id} className="bw-meta"><span className="bw-strong type-quote">{i.body}</span></li>)}
        </ul>
      )}
    </>
  );
}

/* ------------------------------------------------------- photo, music --- */

function Photo({ w }: { w: Widget }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const path = w.opts.path;
  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let live = true;
    void photoUrl(path).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [path]);
  if (!path) return <Invite>Choose a photo in Edit.</Invite>;
  if (src === undefined) return <Waiting />;
  if (src === null) return <Failed what="this photo" />;
  return (
    <>
      <img className="bw-photo" src={src} alt={w.opts.caption || 'Photo'} draggable={false} />
      {w.size !== 'peg' && w.opts.caption && <span className="bw-cap">{w.opts.caption}</span>}
    </>
  );
}

function Music({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  const embed = spotifyEmbed(w.opts.url ?? '');
  if (!embed) return <><Head>Spotify</Head><Invite>Paste a Spotify link in Edit. In Spotify: Share, then Copy link.</Invite></>;
  return (
    <iframe
      className="bw-embed"
      title="Spotify player"
      src={`https://open.spotify.com/embed/${embed.kind}/${embed.id}?utm_source=generator`}
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      // A gallery preview and an edited board never play: a finger dragging
      // the widget must not start the music.
      tabIndex={ctx.still ? -1 : undefined}
    />
  );
}

function LinkW({ w }: { w: Widget }) {
  const href = safeLink(w.opts.url ?? '');
  if (!href) return <Invite>Add an address in Edit.</Invite>;
  const host = new URL(href).hostname.replace(/^www\./u, '');
  const label = w.opts.label?.trim() || host;
  const mono = <span className="bw-mono" aria-hidden>{label.slice(0, 1).toUpperCase()}</span>;
  return (
    <a className="bw-out" href={href} target="_blank" rel="noopener noreferrer" data-peg={w.size === 'peg' || undefined}>
      {mono}
      {w.size === 'peg' ? <span className="bw-peglbl">{label}</span> : (
        <>
          <span className="bw-grow" />
          <span className="bw-t2">{label}</span>
          <span className="bw-meta"><span>{host} ↗</span></span>
        </>
      )}
    </a>
  );
}

/* ------------------------------------------------------------ dispatch --- */

export function WidgetBody({ w, ctx }: { w: Widget; ctx: WidgetContext }) {
  switch (w.type) {
    case 'due': return <Due w={w} ctx={ctx} />;
    case 'work': return <Work w={w} ctx={ctx} />;
    case 'now': return <Now w={w} ctx={ctx} />;
    case 'list': return <List w={w} ctx={ctx} />;
    case 'class': return <ClassW w={w} ctx={ctx} />;
    case 'week': return <Week w={w} ctx={ctx} />;
    case 'month': return <Month w={w} ctx={ctx} />;
    case 'agenda': return <Agenda w={w} ctx={ctx} />;
    case 'exams': return <Exams w={w} ctx={ctx} />;
    case 'clock': return <ClockW w={w} ctx={ctx} />;
    case 'clockday': return <ClockDay w={w} ctx={ctx} />;
    case 'count': return <Count w={w} ctx={ctx} />;
    case 'focus': return <Focus w={w} ctx={ctx} />;
    case 'term': return <TermW w={w} ctx={ctx} />;
    case 'goal': return <GoalW w={w} ctx={ctx} />;
    case 'grades': return <Grades w={w} ctx={ctx} />;
    case 'capture': return <Capture w={w} ctx={ctx} />;
    case 'photo': return <Photo w={w} />;
    case 'music': return <Music w={w} ctx={ctx} />;
    case 'link': return <LinkW w={w} />;
  }
}

/** Which widgets fill their whole surface edge to edge, with no padding. */
export const BLEED: ReadonlySet<Widget['type']> = new Set(['photo', 'music']);
