import { useLayoutEffect, useRef } from 'react';
import { effortMinutes, type DayGroup } from '../lib/week';
import { EASE } from '../lib/motion';

/**
 * The week as a strip of days, each with its work drawn as a bar.
 *
 * Week answers "how bad is the next stretch", and that answer is a shape:
 * Thursday has six hours in it and Friday has none. This puts the shape at
 * the top of the screen and makes it the way to move — tap a day to jump to
 * it — so the chart is not decoration above the list but its index.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No colour by "how bad". A bar is minutes, never green for a light day and
 * red for a heavy one: grading days before they happen is the first step to
 * keeping score. Today's bar is lit because it is today, and that is all.
 *
 * Unestimated work is COUNTED, never given invented minutes. A day with work
 * and no estimates says how many things are due instead of drawing a bar
 * that would be partly built on nothing.
 *
 * Replaces "The shape of it" (WeekShape), which drew the same numbers as a
 * separate chart and, from 9 Sep to 4 Oct, drew them as labels with no bars.
 */
export function WeekStrip({
  days,
  today,
  onJump,
}: {
  days: DayGroup[];
  today: string;
  /** Scroll to this day's section. */
  onJump: (day: string) => void;
}) {
  const minutes = days.map(effortMinutes);
  const peak = Math.max(...minutes, 1);
  const bars = useRef<(HTMLElement | null)[]>([]);

  // The bars grow in once, staggered, when the strip first draws; after that
  // a change slides (the CSS transition on transform).
  const grown = useRef(false);
  useLayoutEffect(() => {
    if (grown.current) return;
    grown.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    bars.current.forEach((bar, i) => {
      if (!bar) return;
      const to = getComputedStyle(bar).transform;
      bar.animate([{ transform: 'scaleY(0)' }, { transform: to === 'none' ? 'scaleY(1)' : to }], {
        duration: 520,
        delay: i * 35,
        easing: EASE.settle,
        fill: 'backwards',
      });
    });
  }, []);

  return (
    <div className="mat week-strip" role="group" aria-label="Work due each day. Choose a day to jump to it.">
      {days.map((group, i) => {
        const m = minutes[i];
        const count = group.assignments.length;
        const isToday = group.day === today;
        const date = new Date(`${group.day}T12:00:00Z`);
        const weekday = WEEKDAY[date.getUTCDay()];
        const label = m > 0 ? hours(m) : count > 0 ? `${count} due` : '';
        const spoken = m > 0 ? `${hours(m)} of work` : count > 0 ? `${count} due, not estimated` : 'nothing due';

        return (
          <button
            key={group.day}
            type="button"
            className="ws-day"
            aria-current={isToday ? 'date' : undefined}
            aria-label={`${isToday ? 'Today, ' : ''}${WEEKDAY_LONG[date.getUTCDay()]} ${date.getUTCDate()}, ${spoken}`}
            onClick={() => onJump(group.day)}
          >
            <span aria-hidden className="ws-w">{weekday}</span>
            <span aria-hidden className="ws-n">{date.getUTCDate()}</span>
            <span aria-hidden className="ws-track">
              <span
                ref={(el) => {
                  bars.current[i] = el;
                }}
                className="ws-bar"
                data-empty={m === 0 || undefined}
                style={{ transform: `scaleY(${m > 0 ? Math.max(0.08, m / peak) : 0})` }}
              />
            </span>
            <span aria-hidden className="ws-h">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const hours = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);

/** The week's total, for the header: "22 h of work". */
export function weekTotal(days: DayGroup[]): number {
  return days.reduce((n, d) => n + effortMinutes(d), 0);
}
