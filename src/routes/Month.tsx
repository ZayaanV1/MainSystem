import { useMemo, useState, type CSSProperties } from 'react';
import { readTitle } from '../lib/blocks';
import { Button } from '../components/Button';
import { AssignmentRow } from '../components/AssignmentRow';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { EventSlip } from '../components/EventSlip';
import { SectionHead } from '../components/SectionHead';
import {
  courseVar,
  setAssignmentStatus,
  subtaskProgress,
  type Assignment,
  type Course,
  type TodayData,
} from '../lib/planner';
import { formatDay, todayKey, type DayKey } from '../lib/time';
import { buildMonth, load, monthLabel, shiftMonth, startOfMonth, type MonthCell } from '../lib/month';

/**
 * Month — the shape of a term.
 *
 * This screen answers "where are the walls", which Today and Week cannot: a
 * cluster of four deadlines in the same week is invisible until you can see a
 * month at once.
 *
 * It shows what is DUE and never what was done. A month of past days marked
 * complete-or-not is a completion history wearing a calendar's clothes, and
 * thirty small failures laid out in a grid is the most efficient way to make
 * an app unopenable. A quiet past day and a quiet future day look identical
 * here, because they are.
 *
 * Density is dots, not colour. The urgency ramp stays on the day detail below,
 * where each mark has its written label beside it — a grid of thirty coloured
 * squares would be colour as the only signal, thirty times over.
 */
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function Month({
  data,
  onBack,
  onOpenAssignment,
  onChanged,
}: {
  data: TodayData | null;
  onBack: () => void;
  onOpenAssignment: (a: Assignment) => void;
  onChanged: () => void;
}) {
  const today = todayKey();
  const [anchor, setAnchor] = useState<DayKey>(startOfMonth(today));
  const [selected, setSelected] = useState<DayKey | null>(today);
  const [courseFilter, setCourseFilter] = useState<string | null>(null);

  const courses = data?.courses ?? [];

  const grid = useMemo(() => {
    const keep = <T extends { course_id: string | null }>(rows: T[]) =>
      courseFilter ? rows.filter((r) => r.course_id === courseFilter) : rows;

    return buildMonth(anchor, keep(data?.assignments ?? []), keep(data?.events ?? []), today);
  }, [anchor, data, courseFilter, today]);

  const courseFor = (id: string | null) => courses.find((c) => c.id === id);
  const progressFor = (id: string) => subtaskProgress(data?.subtasks ?? [], id);
  const toggle = (a: Assignment) =>
    void setAssignmentStatus(a.id, a.status === 'done' ? 'todo' : 'done').then(onChanged);

  const openCell = selected
    ? grid.weeks.flat().find((c) => c.day === selected) ?? null
    : null;

  function step(months: number) {
    const next = shiftMonth(anchor, months);
    setAnchor(next);
    // Selecting nothing in a month you have merely glanced at avoids the day
    // detail below jumping to an arbitrary date.
    setSelected(next.slice(0, 7) === today.slice(0, 7) ? today : null);
  }

  return (
    <main className="page-frame">
      {/*
        The month as a masthead: its name at display size, the year set small
        beside it in numerals, and the arrows beside those. "Month" as an h1
        over a smaller "September 2026" was a label for the screen sitting on
        top of the thing the screen is about.
      */}
      <header className="mb-6 flex items-end justify-between gap-4 px-4">
        <div className="min-w-0">
          <h1 className="sr-only">Month</h1>
          <p className="kicker mb-2">Month</p>
          <p className="flex items-baseline gap-3">
            <span className="type-masthead text-text-hi">{monthLabel(anchor).split(' ')[0]}</span>
            <span className="numeral text-text-low" style={{ fontSize: '1.5rem' }}>{anchor.slice(0, 4)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous month"
            className="btn btn-quiet btn-icon"
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next month"
            className="btn btn-quiet btn-icon"
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
          <Button variant="quiet" onClick={onBack}>
            Today
          </Button>
        </div>
      </header>

      {courses.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 px-4">
          <Chip selected={courseFilter === null} onClick={() => setCourseFilter(null)}>
            All
          </Chip>
          {courses.map((c) => (
            <Chip
              key={c.id}
              courseVar={courseVar(c.colour_index)}
              selected={courseFilter === c.id}
              onClick={() => setCourseFilter(courseFilter === c.id ? null : c.id)}
            >
              {c.code ?? c.name}
            </Chip>
          ))}
        </div>
      )}

      <div className="mb-2 grid grid-cols-7 gap-1.5 px-4" aria-hidden>
        {WEEKDAY_INITIALS.map((d, i) => (
          <span key={i} className="kicker justify-center">
            {d}
          </span>
        ))}
      </div>

      <div className="mb-8 grid grid-cols-7 gap-1.5 px-4" role="grid" aria-label={monthLabel(anchor)}>
        {grid.weeks.flat().map((cell) => (
          <DayCell
            key={cell.day}
            cell={cell}
            courseFor={courseFor}
            selected={cell.day === selected}
            onSelect={() => setSelected(cell.day === selected ? null : cell.day)}
          />
        ))}
      </div>

      {openCell && (
        <DayDetail
          cell={openCell}
          courseFor={courseFor}
          progressFor={progressFor}
          onToggle={toggle}
          onOpen={onOpenAssignment}
        />
      )}

      {grid.undated.length > 0 && (
        <section className="mb-8">
          <SectionHead title="No date" count={grid.undated.length} />
          <p className="type-note -mt-2 mb-3 px-4 text-text-low">
            Belongs to no day, so it is kept here rather than dropped.
          </p>
          <div className="flex flex-col gap-2.5">
            {grid.undated.map((a) => (
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
      )}
    </main>
  );
}

/**
 * One day.
 *
 * Two densities, because a month cell is a different object on a phone and on
 * a laptop. At 45px there is room for a number and a few dots, and tapping is
 * how you find out what they are. At 145px that same design wastes the space
 * and makes you tap to learn something the cell could simply have said.
 *
 * So above lg the cell lists what is actually due, and the dots become the
 * fallback rather than the design. Titles truncate to one line each: the cell
 * is a summary, and the detail panel below is still where the work gets done.
 */
function DayCell({
  cell,
  selected,
  onSelect,
  courseFor,
}: {
  cell: MonthCell;
  selected: boolean;
  onSelect: () => void;
  courseFor: (id: string | null) => Course | undefined;
}) {
  const weight = load(cell);
  const number = Number(cell.day.slice(8));

  const total = cell.assignments.length + cell.events.length;
  const description =
    total === 0 ? 'nothing due' : `${total} due`;

  /*
    Marks, not dots. A deadline is a ring and a class is a bar, each in its
    course's colour — so a week of lectures and a week of deadlines look
    different at a glance, which a row of identical grey dots could not say.
    The accessible name carries the count; the marks are never the only signal.
  */
  const marks = [
    ...cell.assignments.map((a) => ({ id: a.id, due: true, course: courseFor(a.course_id) })),
    ...cell.events.map((e) => ({ id: e.id, due: false, course: courseFor(e.course_id) })),
  ].slice(0, 4);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${formatDay(cell.day)}, ${description}`}
      data-out={cell.inMonth ? undefined : true}
      className={[
        'day-tile',
        'flex aspect-square flex-col items-center justify-center gap-1.5',
        'min-h-0 text-left',
        'lg:aspect-auto lg:min-h-28 lg:items-stretch lg:justify-start lg:p-2',
        // Days outside the month stay legible but recede — they are context,
        // not the subject.
        cell.inMonth ? 'text-text-hi' : 'text-text-low',
      ].join(' ')}
    >
      <span className="day-num lg:self-start" data-today={cell.isToday || undefined}>
        {number}
      </span>

      {/* Marks below lg, where there is no room for anything else. */}
      <span className="flex h-1.5 items-center gap-[3px] lg:hidden" aria-hidden>
        {weight > 0 &&
          marks.map((m) => (
            <span
              key={m.id}
              className="day-mark"
              data-due={m.due || undefined}
              style={{ '--mark': `var(${courseVar(m.course?.colour_index) ?? '--text-low'})` } as CSSProperties}
            />
          ))}
      </span>

      {/* The same information, said rather than encoded, once there is space. */}
      <span className="mt-1 hidden min-w-0 flex-col gap-1 lg:flex" aria-hidden>
        {[...cell.events, ...cell.assignments].slice(0, 3).map((item) => {
          const courseId = (item as { course_id: string | null }).course_id;
          const course = courseFor(courseId);
          return (
            <span key={item.id} className="flex min-w-0 items-center gap-1.5">
              <span
                className="day-mark"
                data-due={'due_at' in item || undefined}
                style={{ '--mark': `var(${courseVar(course?.colour_index) ?? '--text-low'})` } as CSSProperties}
              />
              <span className="truncate type-note text-text-mid">{readTitle(item.title).headline}</span>
            </span>
          );
        })}

        {total > 3 && (
          <span className="type-caption text-text-low">{total - 3} more</span>
        )}
      </span>
    </button>
  );
}

function DayDetail({
  cell,
  courseFor,
  progressFor,
  onToggle,
  onOpen,
}: {
  cell: MonthCell;
  courseFor: (id: string | null) => Course | undefined;
  progressFor: (id: string) => { done: number; total: number } | null;
  onToggle: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
}) {
  const empty = cell.assignments.length === 0 && cell.events.length === 0;

  return (
    <section className="mb-8">
      <SectionHead
        title={cell.isToday ? `Today, ${formatDay(cell.day)}` : formatDay(cell.day)}
        count={cell.assignments.length + cell.events.length || null}
      />

      {empty ? (
        <EmptyState>Nothing due.</EmptyState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {cell.events.map((e) => (
            <EventSlip key={e.id} event={e} course={courseFor(e.course_id)} />
          ))}
          {cell.assignments.map((a) => (
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
      )}
    </section>
  );
}

export { WEEKDAY_NAMES };
