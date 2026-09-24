import type { CSSProperties } from 'react';
import { startBy, startByIsDue, urgencyFor, type Thresholds, type Urgency } from '../lib/urgency';
import { formatDay, formatTime, localDayKey } from '../lib/time';
import type { Assignment, Course } from '../lib/planner';
import { useSwipe } from '../lib/useSwipe';
import { courseVar } from '../lib/planner';

/**
 * One assignment, as a slip.
 *
 * Each piece of work is its own surface now rather than a line in a shared
 * card: a slip of its course's glass, with the countdown to it set as a
 * display numeral on the right. The numeral is the thing a list of deadlines
 * is read for — "how long have I got" — and at the size of a body line it was
 * the smallest text on the row. At display size it can be read down the list
 * without reading any titles at all.
 *
 * The colour law still separates the two systems by form. Urgency is the
 * numeral — its colour and its words; the course is the glass the slip is
 * made of. There used to be a 3px urgency bar down the left edge as well: it
 * said again what the numeral already said, and a solid stripe on every card
 * was the one element that read as a template rather than as a material. The
 * urgency colour still never appears without its words — the numeral carries
 * a unit ("days", "late", "today"), and the full label is what a screen
 * reader hears.
 *
 * Two targets, not one: the ring ticks it off, the body opens it. The
 * checklist deliberately does the opposite — a single whole-row target —
 * because ticking is almost the only thing you do there.
 *
 * Nothing on the slip moves when pressed except by scaling in place. A row
 * that lifted on the phone's simulated hover and dropped on the press made
 * every tap on the work list a jitter.
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

/**
 * The countdown, as a numeral and its unit.
 *
 * Derived from the urgency rather than recomputed, so the big number and the
 * written label can never disagree.
 */
function countdown(
  u: Urgency,
  due: Date | null,
  hasTime: boolean,
): { big: string; unit: string } {
  switch (u.state) {
    case 'done':
      return { big: '✓', unit: 'done' };
    case 'undated':
      return { big: '—', unit: 'no date' };
    case 'overdue': {
      const late = Math.abs(u.days ?? 0);
      return late === 0 ? { big: '0', unit: 'overdue' } : { big: String(late), unit: late === 1 ? 'day late' : 'days late' };
    }
    default:
      if (u.days === 0) {
        if (due && hasTime) {
          const t = formatTime(due);
          const m = /^(\d{1,2}:\d{2})\s*(.*)$/u.exec(t);
          return m ? { big: m[1], unit: `${m[2]} today` } : { big: t, unit: 'today' };
        }
        return { big: '0', unit: 'today' };
      }
      return { big: String(u.days ?? ''), unit: u.days === 1 ? 'day' : 'days' };
  }
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
  const count = countdown(urgency, due, assignment.due_has_time);

  const start = startBy(due, assignment.effort_minutes, assignment.start_by_override);
  // Only surfaced once it is relevant. "Start by 12 December" in August is
  // noise, and noise on this screen is what makes the screen ignorable.
  const showStart = !done && startByIsDue(start, now);

  const dueLabel = due
    ? assignment.due_has_time
      ? `${formatDay(localDayKey(due))} · ${formatTime(due)}`
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

  const cv = courseVar(course?.colour_index);
  const tint = (cv ? { '--b': `var(${cv}-rgb)` } : {}) as CSSProperties;
  const code = course ? (course.code ?? course.name) : null;

  return (
    <div className="relative" data-row={assignment.id}>
      {/*
        What the gesture will do, revealed underneath the slip as it moves.
        Both sit behind the content and are never announced — the slip's own
        buttons already carry the accessible names, and a screen reader user
        is not swiping.
      */}
      {swipe.dx !== 0 && (
        <span
          aria-hidden
          className={[
            'absolute inset-y-0 flex items-center px-5 type-caption',
            swipe.dx > 0 ? 'left-0 text-t-done' : 'right-0 text-text-mid',
            swipe.armed ? 'opacity-100' : 'opacity-50',
          ].join(' ')}
        >
          {swipe.dx > 0 ? (done ? 'Reopen' : 'Done') : 'Tomorrow'}
        </span>
      )}

      <div
        {...swipe.handlers}
        className="mat slip flex items-stretch"
        data-block={cv ? true : undefined}
        style={{
          ...tint,
          transform: swipe.dx === 0 ? undefined : `translate3d(${swipe.dx}px, 0, 0)`,
          // No transition while the finger is down: the slip must track the
          // finger exactly, and easing it makes the gesture feel like lag.
          transition: swipe.dx === 0 ? 'transform 220ms var(--ease-out)' : 'none',
        }}
      >
        <button
          type="button"
          onClick={onToggleDone}
          aria-pressed={done}
          aria-label={done ? `Mark ${assignment.title} not done` : `Mark ${assignment.title} done`}
          className="flex min-h-[var(--tap)] w-12 shrink-0 items-center justify-center pl-1"
        >
          <span aria-hidden className="tick" data-done={done || undefined}>
            {done && (
              <svg viewBox="0 0 12 12" className="h-3 w-3">
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
          className="flex min-h-[var(--tap)] min-w-0 flex-1 flex-col justify-center gap-1 py-3.5 pr-2 text-left"
        >
          {/* What it belongs to and when, as the kicker over the title. */}
          {(code || dueLabel) && (
            <span className="kicker">
              {code && (
                <span className="flex items-center gap-1.5">
                  {cv && <span aria-hidden data-block className="chip-dot" style={tint} />}
                  {code}
                </span>
              )}
              {code && dueLabel && <span aria-hidden>·</span>}
              {dueLabel && <span className="blk-num normal-case tracking-normal">{dueLabel}</span>}
            </span>
          )}

          <span
            className={`slip-title ${done ? 'text-text-low line-through decoration-text-low' : 'text-text-hi'}`}
          >
            {assignment.title}
          </span>

          <span className="sr-only">{urgency.label}.</span>

          {(typeof assignment.weight_percent === 'number' ||
            typeof assignment.grade_percent === 'number' ||
            assignment.link ||
            (showStart && start) ||
            progress) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {/*
                What it is worth, when that is known — stated as a share of the
                course, since "30" beside a due date reads as minutes.
              */}
              {typeof assignment.weight_percent === 'number' && (
                <span className="tag type-caption">{assignment.weight_percent}% of grade</span>
              )}
              {/*
                A recorded mark. Never coloured by how good it is: a red 52 and
                a green 91 would be the app grading the person.
              */}
              {typeof assignment.grade_percent === 'number' && (
                <span className="tag type-caption">scored {assignment.grade_percent}%</span>
              )}
              {/*
                An anchor rather than a button, so it behaves like a link: long
                press, open in a new tab, copy address. stopPropagation keeps a
                tap on the link from also opening the editor.
              */}
              {assignment.link && (
                <a
                  href={assignment.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                  className="tag type-caption text-text-mid underline decoration-dotted underline-offset-2"
                >
                  Open
                </a>
              )}
              {showStart && start && (
                <span className="type-caption text-text-mid">start by {formatDay(start)}</span>
              )}
              {/* Surfaced rather than hidden behind a tap: knowing three of
                  five steps are done is most of what decides whether to pick
                  this up. */}
              {progress && (
                <span className="type-caption text-text-mid">
                  {progress.done} of {progress.total} steps
                </span>
              )}
            </span>
          )}
        </button>

        {/*
          The countdown. A display numeral in the urgency colour, with its unit
          in words beneath it, and the one-tap push to tomorrow under that.
          Deferring costs nothing and says nothing, per the spec: a push that
          feels like an admission is one avoided by not opening the app.
        */}
        <div className="flex shrink-0 flex-col items-end justify-center gap-1 py-3 pr-4 pl-1">
          <span aria-hidden className="flex flex-col items-end">
            <span className="slip-count" style={{ color: `var(${urgency.colourVar})` }}>
              {count.big}
            </span>
            <span className="type-caption text-text-low">{count.unit}</span>
          </span>
          {onDefer && !done && assignment.due_at && (
            <button
              type="button"
              onClick={onDefer}
              aria-label={`Push "${assignment.title}" to tomorrow`}
              className="hit-expand action-chip-sm type-caption"
            >
              Tomorrow
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
