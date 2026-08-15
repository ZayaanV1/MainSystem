import type { ReactNode } from 'react';

/**
 * CheckRow.
 *
 * The whole row is the tap target — 44px minimum, no hunting for a small box.
 * Completion is instant and optimistic. Undo is a tap in the same place, so
 * there is nothing to learn and nothing to undo-hunt for.
 *
 * There is no confirmation dialog, and there is no animation on completion
 * beyond the colour settling. A checklist that celebrates is a checklist that
 * implies the other days were failures.
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
        aria-hidden
        className={[
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
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
