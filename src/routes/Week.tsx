import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '../components/Button';
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
  type PlannerEvent,
  type TodayData,
} from '../lib/planner';
import { formatDay, formatTime, todayKey } from '../lib/time';
import { effortMinutes, groupWeek, type DayGroup } from '../lib/week';
import { WeekShape } from '../components/WeekShape';
import { BubbleWeek, LedgerWeek, StylePicker, TicketWeek, type StyleProps } from '../components/calendar/WeekStyles';
import { HoursWeek } from '../components/calendar/Hours';
import { readCalendarStyle, writeCalendarStyle, type CalendarStyle } from '../lib/calendarStyle';
import { withTransition } from '../lib/transition';
import { useNow } from '../lib/useNow';
import { readTitle } from '../lib/blocks';

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
  onPlan,
}: {
  data: TodayData | null;
  onBack: () => void;
  onOpenAssignment: (a: Assignment) => void;
  onChanged: () => void;
  /** Takes you where work is added. Used only by the empty state. */
  onPlan: () => void;
}) {
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
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

  /*
   * The forecast has been computed since Phase 6 and drawn nowhere. Week has
   * always been a list of items grouped under headings, which says what is due
   * and cannot say that Thursday has six hours in it and Friday has none.
   */
  const shapeTasks = (data?.assignments ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: a.effort_minutes,
    status: a.status,
    deferrals: data?.deferrals[a.id] ?? 0,
    weight_percent: a.weight_percent,
  }));

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
    void setAssignmentStatus(a.id, a.status === 'done' ? 'todo' : 'done').then(onChanged);

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

  const nothingAtAll =
    grouping.overdue.length === 0 &&
    grouping.undated.length === 0 &&
    grouping.days.every((d) => d.assignments.length === 0 && d.events.length === 0);

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <div>
          <h1 className="type-h1 text-text-hi">Week</h1>
          <p className="type-caption mt-1 text-text-low">
            {formatDay(today)} to {formatDay(grouping.days[WEEK_DAYS - 1].day)}
          </p>
        </div>
        <Button variant="quiet" onClick={onBack}>
          Today
        </Button>
      </header>

      <div className="mb-6 px-4">
        <StylePicker value={style} onChange={changeStyle} />
      </div>

      <WeekShape tasks={shapeTasks} from={today} />

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
          Nothing due in the next seven days.
        </EmptyState>
      )}

      {grouping.overdue.length > 0 && (
        <section className="mb-8">
          <h2 className="type-h2 mb-3 px-4 text-text-hi">Overdue</h2>
          <Card>
            {grouping.overdue.map((a) => (
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

      {/* Keyed on the style so the entrance plays for the new drawing. */}
      <div key={style} className="mb-8">
        {style === 'bubble' ? (
          <BubbleWeek {...styleProps} />
        ) : style === 'hours' ? (
          <HoursWeek {...styleProps} />
        ) : style === 'ticket' ? (
          <TicketWeek {...styleProps} />
        ) : style === 'ledger' ? (
          <LedgerWeek {...styleProps} />
        ) : (
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
        )}
      </div>

      {grouping.undated.length > 0 && (
        <section className="mb-8">
          <h2 className="type-h2 mb-1 px-4 text-text-hi">No date</h2>
          <p className="type-note mb-3 px-4 text-text-low">
            Kept here so it is not lost. Give it a date when you know one.
          </p>
          <Card>
            {grouping.undated.map((a) => (
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

      {grouping.laterCount > 0 && (
        <p className="mb-12 px-4 type-note text-text-low">
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
    <section className="relative flex gap-3 px-4">
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
            {weekdayShort(group.day)}
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
            <div className="h-px w-full bg-ink-600/50" />
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
            <Card>
              {group.events.map((e) => (
                <EventRow key={e.id} event={e} course={courseFor(e.course_id)} />
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
            </Card>
          </>
        )}
      </div>
    </section>
  );
}

/** Three-letter weekday for a local day key. Noon UTC, so no zone can shift it. */
const WEEKDAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function weekdayShort(day: string): string {
  return WEEKDAY_SHORT[new Date(`${day}T12:00:00Z`).getUTCDay()];
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
          <span className="type-body text-text-hi">{readTitle(event.title).headline}</span>
        </span>
        <span className="mt-1 flex flex-wrap gap-x-2 type-caption text-text-low">
          <span>{event.source ?? event.kind}</span>
          <span>{when}</span>
          {event.location && <span>{event.location}</span>}
        </span>
      </div>
    </div>
  );
}

