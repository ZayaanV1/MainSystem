import { useMemo, useState } from 'react';
import { AssignmentRow } from '../components/AssignmentRow';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import {
  courseVar,
  setAssignmentStatus,
  subtaskProgress,
  type Assignment,
  type Course,
  type TodayData,
} from '../lib/planner';
import { formatDay, formatTime, todayKey, type DayKey } from '../lib/time';
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
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Month</h1>
        <button type="button" onClick={onBack} className="type-label text-text-mid">
          Today
        </button>
      </header>

      <div className="mb-4 flex items-center justify-between gap-4 px-4">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous month"
          className="type-label px-2 text-text-mid"
        >
          Back
        </button>
        <span className="type-h2 text-text-hi">{monthLabel(anchor)}</span>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next month"
          className="type-label px-2 text-text-mid"
        >
          Next
        </button>
      </div>

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

      <div className="mb-2 grid grid-cols-7 gap-1 px-4" aria-hidden>
        {WEEKDAY_INITIALS.map((d, i) => (
          <span key={i} className="text-center type-caption text-text-low">
            {d}
          </span>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-7 gap-1 px-4" role="grid" aria-label={monthLabel(anchor)}>
        {grid.weeks.flat().map((cell) => (
          <DayCell
            key={cell.day}
            cell={cell}
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
          <h2 className="type-h2 mb-1 px-4 text-text-hi">No date</h2>
          <p className="type-note mb-3 px-4 text-text-low">
            Belongs to no day, so it is kept here rather than dropped.
          </p>
          <Card>
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
          </Card>
        </section>
      )}
    </main>
  );
}

function DayCell({
  cell,
  selected,
  onSelect,
}: {
  cell: MonthCell;
  selected: boolean;
  onSelect: () => void;
}) {
  const weight = load(cell);
  const number = Number(cell.day.slice(8));

  const total = cell.assignments.length + cell.events.length;
  const description =
    total === 0 ? 'nothing due' : `${total} due`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${formatDay(cell.day)}, ${description}`}
      className={[
        'flex aspect-square flex-col items-center justify-center gap-1 rounded-card',
        'min-h-0',
        selected ? 'bg-ink-600' : cell.isToday ? 'bg-ink-700' : '',
        // Days outside the month stay legible but recede — they are context,
        // not the subject.
        cell.inMonth ? 'text-text-hi' : 'text-text-low',
      ].join(' ')}
    >
      <span className={`type-label ${cell.isToday ? 'text-text-hi' : ''}`}>{number}</span>

      {/* Density as dots. Never a number at this size, never colour alone. */}
      <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
        {Array.from({ length: weight }, (_, i) => (
          <span key={i} className="h-1 w-1 rounded-pill bg-text-mid" />
        ))}
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
      <h2 className="type-h2 mb-3 px-4 text-text-hi">
        {cell.isToday ? `Today, ${formatDay(cell.day)}` : formatDay(cell.day)}
      </h2>

      {empty ? (
        <EmptyState>Nothing due.</EmptyState>
      ) : (
        <Card>
          {cell.events.map((e) => (
            <div
              key={e.id}
              className="flex items-stretch gap-3 border-b border-ink-600 last:border-b-0"
            >
              <span aria-hidden className="w-[3px] shrink-0 rounded-pill bg-text-mid" />
              <div className="flex min-h-[var(--tap)] flex-1 flex-col justify-center py-3 pr-4">
                <span className="type-body text-text-hi">{e.title}</span>
                <span className="mt-1 flex gap-x-2 type-caption text-text-low">
                  <span>{e.kind}</span>
                  <span>{e.all_day ? 'All day' : formatTime(new Date(e.starts_at))}</span>
                </span>
              </div>
            </div>
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
        </Card>
      )}
    </section>
  );
}

export { WEEKDAY_NAMES };
