import { forecast, type Task } from '../lib/intelligence';
import { addDays, todayKey, type DayKey } from '../lib/time';

/**
 * The week, as a shape rather than a list.
 *
 * The forecast has existed since Phase 6 — minutes of work due per day — and
 * nothing has ever drawn it. Week is a list of items grouped under headings,
 * which tells you WHAT is due and says nothing about the thing a list is worst
 * at conveying: that Thursday has six hours in it and Friday has none.
 *
 * That gap is the whole point of this component. Knowing a deadline exists and
 * feeling how much of the week it occupies are different kinds of knowing, and
 * the second is the one a list cannot deliver. The data was already computed
 * and thrown away at render.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No colour by "how bad". A day is a bar, and the bar is minutes — it is never
 * green for a good day and red for a heavy one, because that grades the week
 * before it has happened and grading days is the first step to keeping score.
 * The heaviest day is the tallest one; that is the entire encoding.
 *
 * Unestimated work is COUNTED, never given invented minutes. A bar that
 * silently assumed an hour each would be confident and partly built on
 * nothing, which is the rule the forecast itself already follows.
 */

interface WeekShapeProps {
  tasks: Task[];
  /** First day shown. Defaults to today. */
  from?: DayKey;
  days?: number;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeekShape({ tasks, from = todayKey(), days = 7 }: WeekShapeProps) {
  const f = forecast(tasks, { from, days });
  const byDay = new Map(f.days.map((d) => [d.day, d.minutes]));

  const span = Array.from({ length: days }, (_, i) => addDays(from, i));
  const minutes = span.map((d) => byDay.get(d) ?? 0);
  const peak = Math.max(...minutes, 1);

  // Nothing due all week: a flat row of empty columns says that better than a
  // chart of zeroes, which reads as a broken chart.
  if (f.totalMinutes === 0 && f.unestimated === 0) return null;

  const hours = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);

  return (
    <section className="mb-8 px-4">
      <h2 className="type-h2 mb-1 text-text-hi">The shape of it</h2>
      <p className="type-note mb-3 text-text-low">
        Estimated work due each day.
        {f.unestimated > 0 &&
          ` ${f.unestimated} ${f.unestimated === 1 ? 'item has' : 'items have'} no estimate and ${
            f.unestimated === 1 ? 'is' : 'are'
          } not counted here.`}
      </p>

      <div className="flex items-end gap-1.5" style={{ height: '7rem' }}>
        {span.map((day, i) => {
          const m = minutes[i];
          const isToday = day === todayKey();
          return (
            <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {/* The number sits above its own bar so the shape is never the
                  only signal — the same rule the rings and the urgency ramp
                  follow. */}
              <span className="type-caption tabular-nums text-text-low">
                {m > 0 ? hours(m) : ''}
              </span>

              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-t-[3px] ${
                    isToday ? 'bg-accent' : m > 0 ? 'bg-ink-500' : 'bg-ink-700'
                  }`}
                  style={{
                    // A day with work always draws something, so "a little" and
                    // "nothing" stay visibly different at a glance.
                    height: m > 0 ? `${Math.max(6, (m / peak) * 100)}%` : '2px',
                  }}
                />
              </div>

              <span
                className={`type-caption ${isToday ? 'text-text-hi' : 'text-text-low'}`}
              >
                {WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
