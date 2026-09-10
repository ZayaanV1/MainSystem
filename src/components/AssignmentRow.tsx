import { startBy, startByIsDue, urgencyFor, type Thresholds } from '../lib/urgency';
import { formatDay, formatTime, localDayKey } from '../lib/time';
import type { Assignment, Course } from '../lib/planner';
import { useSwipe } from '../lib/useSwipe';
import { courseVar } from '../lib/planner';

/**
 * One assignment.
 *
 * The colour law gives both urgency and courses a claim on an edge, so they
 * are separated by form as well as by hue: urgency is the vertical bar down
 * the left, the course is a 6px dot beside the title. Warm bar, cool dot,
 * different shapes — legible even if you cannot tell the two hues apart.
 *
 * The urgency colour never appears without its written label. That pairing is
 * the rule, and it is also the entire colourblind-safety answer.
 *
 * Two targets, not one: the box ticks it off, the body opens it. That split is
 * the convention every task app uses, and it is discoverable because the box
 * looks like a box. The checklist deliberately does the opposite — a single
 * whole-row target — because ticking is almost the only thing you do there,
 * and a second control beside it would be a mis-tap at 7am.
 */

interface AssignmentRowProps {
  assignment: Assignment;
  course?: Course;
  thresholds?: Thresholds;
  now?: Date;
  onToggleDone: () => void;
  onOpen?: () => void;
  /**
   * Push this to tomorrow.
   *
   * Optional so the row stays usable in views where deferring makes no sense,
   * such as a past day in the history grid.
   */
  onDefer?: () => void;
  /** Steps completed, when the work has been broken down. */
  progress?: { done: number; total: number } | null;
}

export function AssignmentRow({
  assignment,
  course,
  thresholds,
  now,
  onToggleDone,
  onOpen,
  onDefer,
  progress,
}: AssignmentRowProps) {
  const due = assignment.due_at ? new Date(assignment.due_at) : null;
  const done = assignment.status === 'done';

  const urgency = urgencyFor(due, { done, now, thresholds });

  const start = startBy(due, assignment.effort_minutes, assignment.start_by_override);
  // Only surfaced once it is relevant. "Start by 12 December" in August is
  // noise, and noise on this screen is what makes the screen ignorable.
  const showStart = !done && startByIsDue(start, now);

  const dueLabel = due
    ? assignment.due_has_time
      ? `${formatDay(localDayKey(due))} ${formatTime(due)}`
      : formatDay(localDayKey(due))
    : null;

  /*
   * Swipe left to defer, right to complete. Touch only — a desktop user has
   * the buttons, and swipe on a trackpad competes with two-finger back
   * navigation, an argument this app would lose by having the page leave.
   */
  const swipe = useSwipe({
    onLeft: onDefer,
    onRight: onToggleDone,
  });

  return (
    <div className="relative overflow-hidden border-b border-ink-600 last:border-b-0">
      {/*
        What the gesture will do, revealed underneath the row as it moves.
        Both sit behind the content and are never announced — the row's own
        buttons already carry the accessible names, and a screen reader user
        is not swiping.
      */}
      {swipe.dx !== 0 && (
        <span
          aria-hidden
          className={[
            'absolute inset-y-0 flex items-center px-4 type-caption',
            swipe.dx > 0 ? 'left-0 text-t-done' : 'right-0 text-text-mid',
            swipe.armed ? 'opacity-100' : 'opacity-50',
          ].join(' ')}
        >
          {swipe.dx > 0 ? (done ? 'Reopen' : 'Done') : 'Tomorrow'}
        </span>
      )}

      <div
        {...swipe.handlers}
        className="flex items-stretch gap-3 bg-ink-900"
        style={{
          transform: `translate3d(${swipe.dx}px, 0, 0)`,
          // No transition while the finger is down: the row must track the
          // finger exactly, and easing it makes the gesture feel like lag.
          transition: swipe.dx === 0 ? 'transform 220ms var(--ease-out)' : 'none',
        }}
      >
      {/* Urgency, as a bar. Never the only signal — the label below repeats it. */}
      <span
        aria-hidden
        className="w-[3px] shrink-0 rounded-pill"
        style={{ backgroundColor: `var(${urgency.colourVar})` }}
      />

      <button
        type="button"
        onClick={onToggleDone}
        aria-pressed={done}
        aria-label={done ? `Mark ${assignment.title} not done` : `Mark ${assignment.title} done`}
        className="flex min-h-[var(--tap)] w-11 shrink-0 items-center justify-center"
      >
        <span
          aria-hidden
          className={[
            'flex h-5 w-5 items-center justify-center rounded-pill border-2',
            done ? 'border-t-done bg-t-done' : 'border-ink-600',
          ].join(' ')}
        >
          {done && (
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
              <path
                d="M2.5 6.2 L4.8 8.5 L9.5 3.8"
                fill="none"
                stroke="var(--ink-900)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex min-h-[var(--tap)] min-w-0 flex-1 flex-col justify-center py-3 pr-4 text-left"
      >
        <span className="flex items-center gap-2">
          {course && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-pill"
              style={{ backgroundColor: `var(${courseVar(course.colour_index)})` }}
            />
          )}
          <span className={`type-body truncate ${done ? 'text-text-low' : 'text-text-hi'}`}>
            {assignment.title}
          </span>
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="type-caption" style={{ color: `var(${urgency.colourVar})` }}>
            {urgency.label}
          </span>
          {dueLabel && <span className="action-chip-sm type-caption">{dueLabel}</span>}
          {course && <span className="action-chip-sm type-caption">{course.code ?? course.name}</span>}
          {/*
            What it is worth, when that is known. A tag rather than an
            action-chip, because it is a label and not a control — and stated
            as a share of the course rather than a bare number, since "30"
            beside a due date reads as minutes.
          */}
          {typeof assignment.weight_percent === 'number' && (
            <span className="tag type-caption">{assignment.weight_percent}% of grade</span>
          )}
          {/*
            A recorded mark. Never coloured by how good it is: a red 52 and a
            green 91 would be the app grading the person, which is the line
            this feature does not cross.
          */}
          {typeof assignment.grade_percent === 'number' && (
            <span className="tag type-caption">scored {assignment.grade_percent}%</span>
          )}
          {/*
            An anchor rather than a button, so it behaves like a link: long
            press, open in a new tab, copy address. rel="noreferrer" because
            the destination is a third party the app does not control and has
            no reason to hand a referrer to.

            stopPropagation keeps a tap on the link from also opening the
            editor — the row is a tap target and this sits inside it.
          */}
          {assignment.link && (
            <a
              href={assignment.link}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="tag type-caption underline decoration-dotted underline-offset-2"
            >
              Open
            </a>
          )}
          {showStart && start && (
            <span className="type-caption text-text-mid">start by {formatDay(start)}</span>
          )}
          {/* Surfaced rather than hidden behind a tap: knowing three of five
              steps are done is most of what decides whether to pick this up. */}
          {progress && (
            <span className="type-caption text-text-mid">
              {progress.done} of {progress.total} steps
            </span>
          )}
        </span>
      </button>

      {/*
        One tap, no friction, no comment. The spec is explicit that deferring
        must cost nothing: a push that feels like an admission is one avoided
        by not opening the app at all. It is only offered on unfinished work
        that has a date to move.
      */}
      {onDefer && !done && assignment.due_at && (
        <button
          type="button"
          onClick={onDefer}
          aria-label={`Push "${assignment.title}" to tomorrow`}
          className="flex min-h-[var(--tap)] shrink-0 items-center px-4 type-caption text-text-low"
        >
          Tomorrow
        </button>
      )}
      </div>
    </div>
  );
}
