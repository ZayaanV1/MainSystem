import { useMemo, useState } from 'react';
import { AssignmentRow } from '../components/AssignmentRow';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import {
  courseVar,
  setAssignmentStatus,
  type Assignment,
  type Course,
  type PlannerEvent,
  type TodayData,
} from '../lib/planner';
import { formatDay, formatTime, todayKey, type DayKey } from '../lib/time';
import { effortMinutes, groupWeek, type DayGroup } from '../lib/week';

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
 */
const WEEK_DAYS = 7;

export function Week({
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
  const [courseFilter, setCourseFilter] = useState<string | null>(null);

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
  const toggle = (a: Assignment) =>
    void setAssignmentStatus(a.id, a.status === 'done' ? 'todo' : 'done').then(onChanged);

  const nothingAtAll =
    grouping.overdue.length === 0 &&
    grouping.undated.length === 0 &&
    grouping.days.every((d) => d.assignments.length === 0 && d.events.length === 0);

  return (
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <div>
          <h1 className="type-h1 text-text-hi">Week</h1>
          <p className="type-caption mt-1 text-text-low">
            {formatDay(today)} to {formatDay(grouping.days[WEEK_DAYS - 1].day)}
          </p>
        </div>
        <button type="button" onClick={onBack} className="type-label text-text-mid">
          Today
        </button>
      </header>

      {courses.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2 px-4">
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

      {nothingAtAll && <EmptyState>Nothing due in the next seven days.</EmptyState>}

      {grouping.overdue.length > 0 && (
        <section className="mb-8">
          <h2 className="type-h2 mb-3 px-4 text-text-hi">Overdue</h2>
          <Card>
            {grouping.overdue.map((a) => (
              <AssignmentRow
                key={a.id}
                assignment={a}
                course={courseFor(a.course_id)}
                onToggleDone={() => toggle(a)}
                onOpen={() => onOpenAssignment(a)}
              />
            ))}
          </Card>
        </section>
      )}

      {grouping.days.map((group) => (
        <DaySection
          key={group.day}
          group={group}
          isToday={group.day === today}
          courseFor={courseFor}
          onToggle={toggle}
          onOpen={onOpenAssignment}
        />
      ))}

      {grouping.undated.length > 0 && (
        <section className="mb-8">
          <h2 className="type-h2 mb-1 px-4 text-text-hi">No date</h2>
          <p className="type-caption mb-3 px-4 text-text-low">
            Kept here so it is not lost. Give it a date when you know one.
          </p>
          <Card>
            {grouping.undated.map((a) => (
              <AssignmentRow
                key={a.id}
                assignment={a}
                course={courseFor(a.course_id)}
                onToggleDone={() => toggle(a)}
                onOpen={() => onOpenAssignment(a)}
              />
            ))}
          </Card>
        </section>
      )}

      {grouping.laterCount > 0 && (
        <p className="mb-12 px-4 type-caption text-text-low">
          {grouping.laterCount} more after this week.
        </p>
      )}
    </main>
  );
}

/**
 * One day.
 *
 * Empty days are still drawn, because the shape of the week is the
 * information — three empty days followed by four full ones is the thing you
 * came here to see, and collapsing the empty ones hides it.
 */
function DaySection({
  group,
  isToday,
  courseFor,
  onToggle,
  onOpen,
}: {
  group: DayGroup;
  isToday: boolean;
  courseFor: (id: string | null) => Course | undefined;
  onToggle: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
}) {
  const empty = group.assignments.length === 0 && group.events.length === 0;
  const minutes = effortMinutes(group);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-4 px-4">
        <h2 className={`type-label ${isToday ? 'text-text-hi' : 'text-text-mid'}`}>
          {isToday ? `Today, ${formatDay(group.day)}` : formatDay(group.day)}
        </h2>
        {minutes > 0 && (
          <span className="type-caption text-text-low">
            {minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h` : `${minutes} min`}
          </span>
        )}
      </div>

      {empty ? (
        <p className="px-4 type-caption text-text-low">—</p>
      ) : (
        <Card>
          {group.events.map((e) => (
            <EventRow key={e.id} event={e} course={courseFor(e.course_id)} />
          ))}
          {group.assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
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

/**
 * An event.
 *
 * No checkbox: you do not complete an exam, you attend it. Giving it one would
 * imply it is optional, and leaving it permanently unticked would make the day
 * look unfinished forever.
 */
function EventRow({ event, course }: { event: PlannerEvent; course?: Course }) {
  const when = event.all_day ? 'All day' : formatTime(new Date(event.starts_at));

  return (
    <div className="flex items-stretch gap-3 border-b border-ink-600 last:border-b-0">
      <span aria-hidden className="w-[3px] shrink-0 rounded-pill bg-text-mid" />
      <div className="flex min-h-[var(--tap)] flex-1 flex-col justify-center py-3 pr-4">
        <span className="flex items-center gap-2">
          {course && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-pill"
              style={{ backgroundColor: `var(${courseVar(course.colour_index)})` }}
            />
          )}
          <span className="type-body text-text-hi">{event.title}</span>
        </span>
        <span className="mt-1 flex flex-wrap gap-x-2 type-caption text-text-low">
          <span>{event.kind}</span>
          <span>{when}</span>
          {event.location && <span>{event.location}</span>}
        </span>
      </div>
    </div>
  );
}

export type { DayKey };
