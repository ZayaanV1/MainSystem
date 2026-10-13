import { Card } from '../components/Card';
import { Pressable } from '../components/Pressable';
import { courseVar, type Course } from '../lib/planner';
import { sessionCounts, type ClassSummary } from '../lib/classes';
import { usePresence } from '../lib/usePresence';
import { describeDays, sessionOn } from '../../supabase/functions/_shared/classes';
import { activeTimezone, formatDay, formatTimeRange, todayKey } from '../lib/time';

/**
 * The classes typed by hand, each a row that opens it to change, end or
 * delete.
 *
 * Two facts per class and no verdict: how many sessions are still to come,
 * and until when. Nothing here counts what was missed — a class is attended
 * or not, and the app is never told which.
 */
export function ClassList({
  items,
  failed,
  courses,
  onRetry,
  onOpen,
}: {
  items: ClassSummary[] | null;
  failed: boolean;
  courses: Course[];
  onRetry: () => void;
  onOpen: (item: ClassSummary) => void;
}) {
  // Rows arrive and leave on screen (rule 12): a class just added rises in, a
  // deleted one leaves before the list closes up.
  const { list, containerRef } = usePresence(items, (i) => i.series.id, { enter: true });

  if (failed) {
    return (
      <p className="type-note mb-3 px-4 text-text-mid" role="alert">
        Could not load your classes.{' '}
        <button type="button" className="underline" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  }
  if (list.length === 0) return null;

  const tz = activeTimezone();
  const today = todayKey();
  const now = new Date();

  return (
    <div ref={containerRef} className="mb-3 px-4">
      <Card>
        {list.map(({ item, key, leaving }) => {
          const s = item.series;
          const course = courses.find((c) => c.id === s.course_id);
          const at = sessionOn(s.first_day, s, tz);
          const { toCome } = sessionCounts(item.sessions, now);
          const status =
            s.last_day < today
              ? `Ended ${formatDay(s.last_day)}`
              : s.first_day > today
                ? `Starts ${formatDay(s.first_day)} · ${toCome} ${toCome === 1 ? 'class' : 'classes'}`
                : `${toCome} to go · until ${formatDay(s.last_day)}`;
          return (
            <div key={key} data-presence={key} inert={leaving || undefined} className="border-b border-ink-600 last:border-b-0">
              <Pressable align="start" className="mat-row gap-3 px-4 py-3" onClick={() => onOpen(item)}>
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: `var(${courseVar(course?.colour_index) ?? '--text-low'})` }}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-body text-text-hi">{s.title}</span>
                  <span className="type-note text-text-mid">
                    {describeDays(s.weekdays)} · {formatTimeRange(new Date(at.starts_at), new Date(at.ends_at), tz)}
                    {s.location ? ` · ${s.location}` : ''}
                  </span>
                  <span className="type-note text-text-low">{status}</span>
                </span>
              </Pressable>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
