import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChecklistItem } from '../lib/checklist';
import { courseVar, type Assignment, type Course, type PlannerEvent, type TodayData } from '../lib/planner';
import { addDays, formatTime, formatTimeRange, localDayKey, type DayKey } from '../lib/time';
import { urgencyFor } from '../lib/urgency';
import { rowWhen, weekdayShort } from '../lib/rowWhen';
import { whatNow, type Task } from '../lib/intelligence';
import { startSession } from '../lib/focus';
import { createGoal, goalProgress, loadGoals, updateGoal, type Goal } from '../lib/goals';
import { announce } from '../lib/announce';
import { moveCapsule } from '../lib/motion';
import { TickPills } from '../components/TickPills';

/**
 * Today on Vision's desk: the dashboard (lib/vision.ts, Oct 2026).
 *
 * The glass dashboard it is drawn from, filled with this app's day rather
 * than its sample numbers. Every number on it is something still to come;
 * nothing counts days already gone, so no card can turn into a score
 * (rule 3). Every action is the one the phone's Today already has: tick,
 * finish, open, start, step a goal. Nothing here writes anything new.
 */

const WINDOWS = [15, 30, 60, 120] as const;

export interface VisionTodayProps {
  userId: string;
  data: TodayData | null;
  today: DayKey;
  now: Date;
  pills: ChecklistItem[];
  isDone: (itemId: string) => boolean;
  onToggleItem: (id: string) => void;
  onFinish: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
  onOpenChecklist: () => void;
  onAddChecklist: () => void;
  sized: (minutes: number | null) => number | null;
  assistOn: boolean;
  /** The ⋯ menu, as on the phone. */
  menu: ReactNode;
}

export function VisionToday(props: VisionTodayProps) {
  const { data, now, today } = props;
  const open = useMemo(() => (data?.assignments ?? []).filter((a) => a.status !== 'done'), [data]);
  const courses = data?.courses ?? [];
  const course = (id: string | null) => courses.find((c) => c.id === id);

  return (
    <div className="v-dash">
      <Header {...props} open={open} />

      <div className="v-stats">
        <NextDue open={open} now={now} course={course} onOpen={props.onOpen} />
        <UpNext events={data?.events ?? null} now={now} today={today} course={course} />
        <OpenWork open={open} now={now} loading={!data} />
        <Checklist {...props} />
      </div>

      <div className="v-mid">
        <WeekLoad open={open} today={today} sized={props.sized} loading={!data} />
        <Timeline data={data} open={open} today={today} now={now} course={course} onOpen={props.onOpen} />
      </div>

      <div className="v-low">
        <WorkList open={open} now={now} course={course} onFinish={props.onFinish} onOpen={props.onOpen} loading={!data} />
        <ChecklistCard {...props} />
        <GoalCard userId={props.userId} today={today} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- header -- */

function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat('en-CA', { hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Header({ data, now, today, open, onOpen, sized, assistOn, menu }: VisionTodayProps & { open: Assignment[] }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const tasks: Task[] = open.map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: sized(a.effort_minutes),
    status: a.status,
    deferrals: data?.deferrals[a.id] ?? 0,
    weight_percent: a.weight_percent,
  }));
  const choice = assistOn && tasks.length ? whatNow(tasks, { minutesAvailable: minutes }) : null;
  const picked = choice ? open.find((a) => a.id === choice.task.id) ?? null : null;

  // The white capsule slides between the time chips, like the dock's disc.
  const chips = useRef<HTMLDivElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  const index = minutes === null ? -1 : WINDOWS.indexOf(minutes as (typeof WINDOWS)[number]);
  useLayoutEffect(() => {
    const slots = chips.current?.querySelectorAll<HTMLElement>('[data-slot]');
    if (lit.current) moveCapsule(lit.current, index >= 0 ? (slots?.[index] ?? null) : null, 'x');
  }, [index]);

  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(`${today}T12:00:00Z`),
  );

  return (
    <header className="v-head v-card-flat" data-rise="" style={{ ['--i' as string]: 0 }}>
      <div className="min-w-0">
        <h1 className="v-title">
          <span className="sr-only">Today. </span>
          {greeting(now)}
        </h1>
        {picked && choice ? (
          <button type="button" className="v-sub v-sub-link" onClick={() => onOpen(picked)}>
            {date} · Start with <b>{picked.title}</b>. {choice.because}
          </button>
        ) : (
          <p className="v-sub">
            {date}
            {data && open.length === 0 ? ' · Nothing open. That’s everything for today.' : ''}
          </p>
        )}
      </div>

      <div className="v-head-end">
        {assistOn && open.length > 0 && (
          <>
            <div ref={chips} className="v-seg" role="group" aria-label="Time I have">
              <span ref={lit} aria-hidden className="v-seg-lit" style={{ opacity: 0 }} />
              {WINDOWS.map((m) => (
                <button
                  key={m}
                  data-slot
                  type="button"
                  aria-pressed={minutes === m}
                  className={minutes === m ? 'is-on' : ''}
                  onClick={() => setMinutes(minutes === m ? null : m)}
                >
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </button>
              ))}
            </div>
            {picked && (
              <button
                type="button"
                className="v-primary"
                onClick={() => {
                  startSession(picked.id, picked.title);
                  announce(`Started ${picked.title}`);
                }}
              >
                Start on it
              </button>
            )}
          </>
        )}
        {menu}
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- stats -- */

function Stat({
  label,
  value,
  unit,
  children,
  onClick,
  feat = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  children?: ReactNode;
  onClick?: () => void;
  /** The one featured card, in the accent's glass (V7). */
  feat?: boolean;
}) {
  const body = (
    <>
      {/* Label and an arrow, after V7: the arrow only where the card opens something. */}
      <div className="flex items-start justify-between gap-2">
        <p className="v-label">{label}</p>
        {onClick && (
          <span aria-hidden className="v-arrow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </span>
        )}
      </div>
      <p className="v-value">
        <CountUp text={String(value)} />
        {unit && <span className="v-unit">{unit}</span>}
      </p>
      <div className="v-stat-foot">{children}</div>
    </>
  );
  return onClick ? (
    <button type="button" className={`v-card v-lift v-stat text-left ${feat ? 'v-feat' : ''}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <section className={`v-card v-lift v-stat ${feat ? 'v-feat' : ''}`}>{body}</section>
  );
}

/**
 * Every number in a figure climbs from zero on the dashboard's first paint,
 * as V7's do. Once only: a figure that changes later (the minute ticking
 * down, a tick on the checklist) shows its new value at once. Calm and
 * None motion, and reduced motion, show it at once from the start.
 */
function CountUp({ text }: { text: string }) {
  const [t, setT] = useState(1);
  const ran = useRef(false);
  useEffect(() => {
    // A figure that changes after the first count (or mid-count, which cancels
    // it) shows its value at once; it never stays part-way.
    if (ran.current) {
      setT(1);
      return;
    }
    if (!/\d/.test(text)) return;
    ran.current = true;
    const still =
      document.documentElement.dataset.motion !== 'full' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 800);
      setT(1 - (1 - k) ** 3);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setT(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <>{t >= 1 ? text : text.replace(/\d+/g, (n) => String(Math.round(Number(n) * t)))}</>;
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="v-chip" style={{ ['--tone' as string]: `var(${tone})` }}>
      {children}
    </span>
  );
}

function soonest(open: Assignment[], now: Date): Assignment | null {
  const dated = open.filter((a) => a.due_at).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  // The next thing that has not yet passed; failing that, the latest thing that has.
  return dated.find((a) => new Date(a.due_at!) >= now) ?? dated[dated.length - 1] ?? null;
}

function countdown(ms: number): { value: string; unit: string } {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return { value: String(m), unit: 'min' };
  const h = Math.floor(m / 60);
  if (h < 48) return { value: `${h}h ${m % 60}`, unit: 'm' };
  return { value: String(Math.round(h / 24)), unit: 'days' };
}

function NextDue({
  open,
  now,
  course,
  onOpen,
}: {
  open: Assignment[];
  now: Date;
  course: (id: string | null) => Course | undefined;
  onOpen: (a: Assignment) => void;
}) {
  const next = soonest(open, now);
  if (!next) return <Stat label="Next due" value="Clear" feat />;
  const due = new Date(next.due_at!);
  const u = urgencyFor(due, { now });
  const late = due < now;
  const c = late ? null : countdown(due.getTime() - now.getTime());
  return (
    <Stat
      label="Next due"
     
      value={late ? 'Late' : c!.value}
      unit={late ? undefined : c!.unit}
      onClick={() => onOpen(next)}
      feat
    >
      <p className="v-line">
        <CourseDot course={course(next.course_id)} />
        {next.title}
      </p>
      <Chip tone={u.colourVar}>{u.label}</Chip>
    </Stat>
  );
}

function upcoming(events: PlannerEvent[], now: Date): PlannerEvent | null {
  return (
    events
      .filter((e) => !e.all_day && new Date(e.ends_at ?? e.starts_at) > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null
  );
}

function UpNext({
  events,
  now,
  course,
}: {
  events: PlannerEvent[] | null;
  now: Date;
  today: DayKey;
  course: (id: string | null) => Course | undefined;
}) {
  const e = events ? upcoming(events, now) : null;
  if (!e) return <Stat label="Up next" value={events ? 'Free' : '—'} />;
  const start = new Date(e.starts_at);
  const end = e.ends_at ? new Date(e.ends_at) : null;
  const under = start <= now;
  const c = countdown((under && end ? end : start).getTime() - now.getTime());
  // How far through it you are: the one mini that only ever looks ahead.
  const share = under && end ? (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) : 0;
  return (
    <Stat label={under ? 'On now · left' : 'Up next · starts in'} value={c.value} unit={c.unit}>
      <p className="v-line">
        <CourseDot course={course(e.course_id)} />
        {e.title}
      </p>
      {under ? (
        <>
          <span aria-hidden className="v-track">
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          <span className="sr-only">{Math.round(share * 100)}% through</span>
        </>
      ) : (
        <span className="v-meta">{formatTimeRange(start, end)}</span>
      )}
    </Stat>
  );
}

function OpenWork({ open, now, loading }: { open: Assignment[]; now: Date; loading: boolean }) {
  const late = open.filter((a) => a.due_at && new Date(a.due_at) < now).length;
  const week = open.filter((a) => a.due_at && new Date(a.due_at) >= now && new Date(a.due_at).getTime() - now.getTime() < 7 * 864e5).length;
  return (
    <Stat
      label="Open work"
     
      value={loading ? '—' : open.length}
    >
      <p className="v-line text-text-mid">{loading ? 'Loading' : `${week} due this week`}</p>
      {!loading && (late ? <Chip tone="--t-overdue">{late} late</Chip> : <Chip tone="--t-done">None late</Chip>)}
    </Stat>
  );
}

function Checklist({ pills, isDone, onOpenChecklist, data }: VisionTodayProps) {
  const done = pills.filter((p) => isDone(p.id)).length;
  return (
    <Stat
      label="Checklist today"
     
      value={data ? done : '—'}
      unit={data ? `of ${pills.length}` : undefined}
      onClick={onOpenChecklist}
    >
      <span className="v-segs" aria-hidden>
        {pills.map((p) => (
          <span key={p.id} className={isDone(p.id) ? 'on' : ''} />
        ))}
      </span>
      <p className="v-line text-text-mid">{pills.length && done === pills.length ? 'That’s everything for today.' : `${pills.length - done} to go`}</p>
    </Stat>
  );
}

/* ------------------------------------------------------------ week load -- */

function WeekLoad({
  open,
  today,
  sized,
  loading,
}: {
  open: Assignment[];
  today: DayKey;
  sized: (m: number | null) => number | null;
  loading: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const per = days.map((d) => {
    const due = open.filter((a) => a.due_at && localDayKey(new Date(a.due_at)) === d);
    const minutes = due.reduce((s, a) => s + (sized(a.effort_minutes) ?? 0), 0);
    // What the day holds, named, for the label a pointer shows over its bar.
    const names = due.map((a) => (a.due_has_time ? `${a.title} · ${formatTime(new Date(a.due_at!))}` : a.title)).join(', ');
    return { day: d, count: due.length, minutes, unsized: due.filter((a) => a.effort_minutes === null).length, names };
  });
  const max = Math.max(1, ...per.map((p) => p.count));
  const total = per.reduce((s, p) => s + p.count, 0);
  const known = per.reduce((s, p) => s + p.minutes, 0);
  const unsized = per.reduce((s, p) => s + p.unsized, 0);
  return (
    <section className="v-card v-week" aria-label="This week's load">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="v-h">This week’s load</h2>
          <p className="v-meta">
            {loading
              ? 'Loading'
              : `${total} due in seven days${known ? ` · ${Math.round(known / 6) / 10} h estimated` : ''}${unsized ? `, ${unsized} not estimated` : ''}`}
          </p>
        </div>
      </div>
      <div className="v-bars">
        {per.map((p, i) => (
          <div key={p.day} className={`v-bar ${p.day === today ? 'is-today' : ''}`}>
            <span className="sr-only">
              {p.day === today ? 'Today' : weekdayShort(p.day)}: {p.count} due
            </span>
            <span aria-hidden className="v-bar-tip">
              {p.day === today ? 'Today' : weekdayShort(p.day)}: {p.names || 'nothing due'}
            </span>
            <span aria-hidden className="v-bar-n">
              {p.count || ''}
            </span>
            <span aria-hidden className="v-bar-col">
              <span className="v-bar-fill" style={{ height: `${Math.max(6, (p.count / max) * 100)}%`, ['--k' as string]: i }} />
            </span>
            <span aria-hidden className="v-bar-day">
              {p.day === today ? 'Today' : weekdayShort(p.day)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- timeline -- */

type Slot = { key: string; at: Date | null; title: string; sub: string; course?: Course; work?: Assignment };

function Timeline({
  data,
  open,
  today,
  now,
  course,
  onOpen,
}: {
  data: TodayData | null;
  open: Assignment[];
  today: DayKey;
  now: Date;
  course: (id: string | null) => Course | undefined;
  onOpen: (a: Assignment) => void;
}) {
  const slots: Slot[] = [
    ...(data?.events ?? [])
      .filter((e) => localDayKey(new Date(e.starts_at)) === today)
      .map((e) => ({
        key: e.id,
        at: e.all_day ? null : new Date(e.starts_at),
        title: e.title,
        sub: e.all_day ? 'All day' : formatTimeRange(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null),
        course: course(e.course_id),
      })),
    ...open
      .filter((a) => a.due_at && localDayKey(new Date(a.due_at)) === today)
      .map((a) => ({
        key: a.id,
        at: a.due_has_time ? new Date(a.due_at!) : null,
        title: a.title,
        sub: a.due_has_time ? `Due ${formatTime(new Date(a.due_at!))}` : 'Due by end of day',
        course: course(a.course_id),
        work: a,
      })),
  ].sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));

  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(
    new Date(`${today}T12:00:00Z`),
  );

  return (
    <section className="v-card v-today" aria-label="Today's timeline">
      <h2 className="v-h">Today</h2>
      <p className="v-meta">{date}</p>
      {data && slots.length === 0 && <p className="v-empty">Nothing on the clock today.</p>}
      <ol className="v-stagger v-slots">
        {slots.map((s, j) => {
          const past = s.at !== null && s.at < now && !s.work;
          const row = (
            <>
              <span className="v-slot-time">{s.at ? formatTime(s.at) : '—'}</span>
              <span
                className={`v-slot ${past ? 'is-past' : ''}`}
                style={s.course?.colour_index ? { ['--edge' as string]: `var(${courseVar(s.course.colour_index)})` } : undefined}
              >
                <span className="v-slot-title">{s.title}</span>
                <span className="v-slot-sub">
                  {s.course?.code ? `${s.course.code} · ` : ''}
                  {s.sub}
                </span>
              </span>
            </>
          );
          return (
            <li key={s.key} style={{ ['--j' as string]: j }}>
              {s.work ? (
                <button type="button" className="v-slot-row" onClick={() => onOpen(s.work!)}>
                  {row}
                </button>
              ) : (
                <div className="v-slot-row">{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ----------------------------------------------------------- bottom row -- */

function WorkList({
  open,
  now,
  course,
  onFinish,
  onOpen,
  loading,
}: {
  open: Assignment[];
  now: Date;
  course: (id: string | null) => Course | undefined;
  onFinish: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
  loading: boolean;
}) {
  const list = [...open]
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    .slice(0, 5);
  return (
    <section className="v-card v-work" aria-label="Assignments">
      <div className="flex items-center justify-between">
        <h2 className="v-h">Assignments</h2>
        <span className="v-meta">{loading ? '' : `${open.length} open`}</span>
      </div>
      {!loading && open.length === 0 && <p className="v-empty">Nothing open. That’s everything.</p>}
      <ul className="v-stagger v-rows">
        {list.map((a, j) => {
          const due = a.due_at ? new Date(a.due_at) : null;
          const u = urgencyFor(due, { now });
          const when = rowWhen(u, due, a.due_has_time, now);
          return (
            <li key={a.id} style={{ ['--j' as string]: j }}>
              <button type="button" className="v-tick" aria-label={`Mark ${a.title} done`} onClick={() => onFinish(a)} />
              <button type="button" className="v-row-main" onClick={() => onOpen(a)}>
                <CourseDot course={course(a.course_id)} />
                <span className="truncate">{a.title}</span>
              </button>
              {when && (
                <span className="v-when" style={{ color: `var(${u.colourVar})` }}>
                  {when}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ChecklistCard({ pills, isDone, onToggleItem, onOpenChecklist, onAddChecklist, data }: VisionTodayProps) {
  const all = pills.length > 0 && pills.every((p) => isDone(p.id));
  return (
    <section className="v-card v-check" aria-label="Checklist">
      <div className="flex items-center justify-between">
        <h2 className="v-h">Checklist</h2>
        <button type="button" className="v-link" onClick={onOpenChecklist}>
          Past days
        </button>
      </div>
      {data && (
        <TickPills items={pills} isDone={isDone} onToggle={onToggleItem} onOpenList={onOpenChecklist} onAdd={onAddChecklist} />
      )}
      {/* Said once, for this day, and never compared to any other. */}
      {all && <p className="v-meta text-t-done">That’s everything for today.</p>}
    </section>
  );
}

function GoalCard({ userId, today }: { userId: string; today: DayKey }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('10');

  useEffect(() => {
    void loadGoals().then(({ goals: g, error }) => {
      setGoals(g);
      setFailed(Boolean(error));
    });
  }, []);

  const goal = goals?.find((g) => g.have < g.target) ?? goals?.[0] ?? null;

  const step = useCallback((g: Goal) => {
    if (g.have >= g.target) return;
    const next = g.have + 1;
    setGoals((gs) => gs?.map((x) => (x.id === g.id ? { ...x, have: next } : x)) ?? gs);
    announce(`${g.title}: ${next} of ${g.target}`);
    void updateGoal(g.id, { have: next }).then(({ error }) => {
      if (error) {
        setGoals((gs) => gs?.map((x) => (x.id === g.id ? { ...x, have: g.have } : x)) ?? gs);
        setFailed(true);
      }
    });
  }, []);

  async function add() {
    const n = Math.max(1, Math.min(1000, Number(target) || 1));
    const { goal: made, error } = await createGoal(userId, { title, unit: '', have: 0, target: n, by_day: null });
    if (error || !made) {
      setFailed(true);
      return;
    }
    setGoals((gs) => [...(gs ?? []), made]);
    setAdding(false);
    setTitle('');
  }

  const p = goal ? goalProgress(goal, today) : null;
  const r = 26;
  const c = 2 * Math.PI * r;

  return (
    <section className="v-card v-goal" aria-label="Goal">
      <div className="flex items-center justify-between">
        <h2 className="v-h">Goal</h2>
        {goal && !adding && (
          <button type="button" className="v-link" onClick={() => setAdding(true)}>
            New
          </button>
        )}
      </div>
      {failed && <p className="v-meta text-t-critical">Couldn’t save or load goals. Try again.</p>}
      {goals === null && !failed && <p className="v-meta">Loading</p>}
      {goal && p && !adding && (
        <div className="v-goal-body">
          <span className="v-ring" role="img" aria-label={`${goal.have} of ${goal.target}`}>
            <svg width="68" height="68" viewBox="0 0 68 68">
              <circle cx="34" cy="34" r={r} className="v-ring-track" />
              <circle
                cx="34"
                cy="34"
                r={r}
                className="v-ring-fill"
                strokeDasharray={c}
                style={{ ['--off' as string]: c * (1 - p.share), ['--full' as string]: c }}
              />
            </svg>
            <b>{Math.round(p.share * 100)}%</b>
          </span>
          <div className="min-w-0">
            <p className="v-line">{goal.title}</p>
            <p className="v-meta">
              {goal.have} of {goal.target}
              {goal.unit ? ` ${goal.unit}` : ''}
              {p.daysLeft !== null ? ` · ${p.daysLeft} days left` : ''}
            </p>
            {!p.reached && (
              <button type="button" className="v-step" onClick={() => step(goal)}>
                +1
              </button>
            )}
          </div>
        </div>
      )}
      {(adding || (goals !== null && goals.length === 0)) && (
        <form
          className="v-goal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="sr-only" htmlFor="v-goal-title">
            Goal
          </label>
          <input id="v-goal-title" className="well" placeholder="Read Leviathan" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="sr-only" htmlFor="v-goal-target">
            How many
          </label>
          <input id="v-goal-target" className="well w-16" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
          <button type="submit" className="v-primary" disabled={!title.trim()}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}

function CourseDot({ course }: { course: Course | undefined }) {
  if (!course?.colour_index) return null;
  return <span aria-hidden className="v-dot" style={{ background: `var(${courseVar(course.colour_index)})` }} />;
}
