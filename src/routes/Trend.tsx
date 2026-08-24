import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { drawPath } from '../lib/motion';
import { EmptyState } from '../components/EmptyState';
import { loadTrendDays, targetsFor, type MacroBand } from '../lib/diet';
import { addDays, todayKey } from '../lib/time';
import { weeklyTrend, weightChange, type WeekPoint } from '../lib/trend';

/**
 * Weight against calories, by week.
 *
 * The one screen in the app that looks backwards, and therefore the one most
 * at risk of breaking rule 3. It shows no streak, counts no misses, and grades
 * no direction. A week you did not weigh yourself is a gap in the line, not a
 * hole in a record.
 *
 * Weekly rather than daily on purpose. Daily weight is water and salt; a chart
 * of it invites a reaction to noise, which is the opposite of what a feedback
 * loop is for.
 */

const WEEKS = 12;

export function Trend({ onBack }: { onBack: () => void }) {
  const [weeks, setWeeks] = useState<WeekPoint[] | null>(null);
  const [calorieTarget, setCalorieTarget] = useState<MacroBand | null>(null);

  useEffect(() => {
    const to = todayKey();
    const from = addDays(to, -(WEEKS * 7));
    void loadTrendDays(from, to).then((days) => setWeeks(weeklyTrend(days)));
    void targetsFor(to).then((t) => setCalorieTarget(t?.calories ?? null));
  }, []);

  if (!weeks) return null;

  const change = weightChange(weeks);
  const weighed = weeks.filter((w) => w.kg !== null);

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Weight trend</h1>
        <Button variant="quiet" onClick={onBack}>
          Diet tracker
        </Button>
      </header>

      {weighed.length === 0 ? (
        <EmptyState>
          No weigh-ins yet. Add one on the food screen and this fills in.
        </EmptyState>
      ) : (
        <>
          <section className="mb-8 px-4">
            <Chart weeks={weeks} calorieTarget={calorieTarget} />
          </section>

          {change && (
            <p className="mb-8 px-4 type-body text-text-mid">
              {describeChange(change)}
            </p>
          )}

          <section className="mb-12">
            <h2 className="type-h2 mb-3 px-4 text-text-hi">By week</h2>
            <div className="flex flex-col">
              {[...weeks].reverse().map((w) => (
                <div
                  key={w.weekStart}
                  className="flex items-baseline justify-between gap-4 border-b border-ink-600 px-4 py-3"
                >
                  <span className="type-body text-text-hi">{formatWeek(w.weekStart)}</span>
                  <span className="type-note text-text-low">
                    {w.kg === null ? 'not weighed' : `${w.kg} kg`}
                    {' · '}
                    {w.calories === null
                      ? 'nothing logged'
                      : `${w.calories.toLocaleString('en-CA')} kcal/day${rangeNote(w.calories, calorieTarget)}`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

/**
 * Plain language, and no verdict.
 *
 * There is no target weight in this app, so neither direction is praised or
 * scolded. "Up 0.4 kg" is the whole sentence; what it means is not the
 * planner's business.
 */
function describeChange(change: { kg: number; weeksApart: number }): string {
  const span = change.weeksApart === 1 ? 'since last week' : `over ${change.weeksApart} weeks`;
  if (change.kg === 0) return `Level ${span}.`;
  return `${change.kg > 0 ? 'Up' : 'Down'} ${Math.abs(change.kg)} kg ${span}.`;
}

/**
 * Whether a week's average landed in the calorie target.
 *
 * Written out, because colour is never the only signal and the band in the
 * chart is the only other place this is said. Stated as a fact with no verdict
 * attached: "under" is not a scolding and "in range" is not a prize.
 */
function rangeNote(calories: number, target: MacroBand | null): string {
  if (!target) return '';
  if (calories < target.min) return ' · under';
  if (calories > target.max) return ' · over';
  return ' · in range';
}

function formatWeek(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Weight as a line, calories as bars behind it.
 *
 * Hand-drawn SVG rather than a charting library: two series over twelve points
 * is not worth a dependency that can break at 2am, and a library would want
 * its own colours, which the colour law does not allow.
 *
 * Weight uses the macro palette's cool tones — this is a body-composition
 * number, not an urgency one — and calories sit behind it as a low-contrast
 * fill so the line stays the thing being read. Every value is also written out
 * in the list below, because colour is never the only signal.
 */
function Chart({ weeks, calorieTarget }: { weeks: WeekPoint[]; calorieTarget: MacroBand | null }) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Drawn once the geometry exists, and re-drawn when the weeks change, so a
  // new weigh-in re-runs the line rather than appearing at the end of a static
  // one. The dependency is the segment shapes, not the array identity.
  const shape = weeks.map((w) => `${w.weekStart}:${w.kg ?? ''}`).join('|');
  useEffect(() => {
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>('path[data-line]');
    if (paths?.length) drawPath([...paths]);
  }, [shape]);

  const W = 320;
  const H = 160;
  const PAD = { top: 12, right: 8, bottom: 20, left: 8 };

  const kgs = weeks.map((w) => w.kg).filter((k): k is number => k !== null);
  const cals = weeks.map((w) => w.calories).filter((c): c is number => c !== null);

  // A flat span would divide by zero; a hair of padding also stops a
  // half-kilo drift being drawn as a cliff across the full height.
  const kgLow = Math.min(...kgs) - 0.5;
  const kgHigh = Math.max(...kgs) + 0.5;
  // The calorie axis has to contain the target band as well as the data,
  // otherwise a week far under target would push the band off the top and the
  // "was I in range" question would be unanswerable in the one week it matters.
  const calHigh = Math.max(...cals, calorieTarget?.max ?? 0, 1) * 1.12;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = weeks.length > 1 ? innerW / (weeks.length - 1) : 0;

  const x = (i: number) => PAD.left + (weeks.length > 1 ? i * step : innerW / 2);
  const yKg = (kg: number) => PAD.top + innerH - ((kg - kgLow) / (kgHigh - kgLow)) * innerH;
  const yCal = (c: number) => PAD.top + innerH - (c / calHigh) * innerH;

  // Gaps break the line rather than bridging them. A straight segment across
  // three unweighed weeks would draw a trend that was never measured.
  const segments: string[] = [];
  let current: string[] = [];
  weeks.forEach((w, i) => {
    if (w.kg === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yKg(w.kg).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const barWidth = Math.max(4, Math.min(18, step * 0.5));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Weekly weight and calories over ${weeks.length} weeks. ${weeks
        .filter((w) => w.kg !== null)
        .map((w) => `${formatWeek(w.weekStart)}: ${w.kg} kilograms`)
        .join('. ')}`}
    >
      {/*
        The calorie target, as a band rather than a line, because the target is
        a range. This is what makes the bars worth drawing at all: on their own
        they are seven near-identical columns, and the only question they can
        actually answer is whether the week landed inside this strip.
      */}
      {calorieTarget && (
        <rect
          x={0}
          y={yCal(calorieTarget.max)}
          width={W}
          height={Math.max(1, yCal(calorieTarget.min) - yCal(calorieTarget.max))}
          fill="var(--m-calories)"
          opacity="0.14"
        />
      )}

      {weeks.map((w, i) =>
        w.calories === null ? null : (
          <rect
            key={`c${w.weekStart}`}
            x={x(i) - barWidth / 2}
            y={yCal(w.calories)}
            width={barWidth}
            height={PAD.top + innerH - yCal(w.calories)}
            rx="2"
            fill="var(--m-calories)"
            opacity="0.28"
          />
        ),
      )}

      {segments.map((d, i) => (
        <path
          key={i}
          data-line
          d={d}
          fill="none"
          stroke="var(--m-protein)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {weeks.map((w, i) =>
        w.kg === null ? null : (
          <circle key={`k${w.weekStart}`} cx={x(i)} cy={yKg(w.kg)} r="2.5" fill="var(--m-protein)" />
        ),
      )}
    </svg>
  );
}
