import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { drawTick } from '../lib/motion';

/**
 * CheckRow.
 *
 * The whole row is the tap target — 44px minimum, no hunting for a small box.
 * Completion is instant and optimistic. Undo is a tap in the same place, so
 * there is nothing to learn and nothing to undo-hunt for.
 *
 * There is no confirmation dialog. Completing something draws the tick on and
 * settles the box — feedback, not celebration. The spec bans praise that
 * ACCUMULATES, because a streak is losable and the loss becomes the reason not
 * to open the app; warmth in the moment is explicitly allowed. A mark that
 * simply appears is indistinguishable from one that was already there.
 *
 * Nothing animates on the way back. Un-ticking clears the mark instantly,
 * because an undo that performs is an undo that feels like a penalty.
 */

interface CheckRowProps {
  label: string;
  done: boolean;
  onToggle: () => void;
  /** Right-aligned metadata: a dose count, a time, a course. */
  meta?: ReactNode;
  /** A course token name, e.g. '--c-2'. Renders as a 6px dot. */
  courseVar?: string;
  disabled?: boolean;
}

export function CheckRow({ label, done, onToggle, meta, courseVar, disabled }: CheckRowProps) {
  const tick = useRef<SVGPathElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  // Tracks the previous value so the draw fires on the TRANSITION into done,
  // not on every render that happens to find it done — otherwise the whole
  // list redraws itself each time anything else on the screen changes.
  const was = useRef(done);

  useEffect(() => {
    const becameDone = done && !was.current;
    was.current = done;
    if (becameDone && tick.current) drawTick(tick.current, box.current ?? undefined);
  }, [done]);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={done}
      className={[
        'flex w-full items-center gap-3 border-b border-ink-600 px-4 last:border-b-0',
        'min-h-[var(--tap)] text-left transition-colors duration-150 ease-out',
        'disabled:opacity-50',
      ].join(' ')}
    >
      {/* Shape changes as well as colour: filled and ringed are distinguishable
          without seeing hue at all. */}
      <span
        ref={box}
        aria-hidden
        className={[
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
          'transition-colors duration-150 ease-out',
          done ? 'border-t-done bg-t-done' : 'border-ink-600',
        ].join(' ')}
      >
        {done && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
            <path
              ref={tick}
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

      {courseVar && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-pill"
          style={{ backgroundColor: `var(${courseVar})` }}
        />
      )}

      <span className={`flex-1 type-body ${done ? 'text-text-low' : 'text-text-hi'}`}>
        {label}
      </span>

      {meta && <span className="type-caption shrink-0 text-text-low">{meta}</span>}
    </button>
  );
}
