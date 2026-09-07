/**
 * Skeleton — the fourth state.
 *
 * This app could previously show three things and only distinguish two of
 * them. A screen still loading, a screen whose queries failed, and a screen
 * with genuinely nothing on it all rendered as the same emptiness. LoadFailure
 * separated the failure; this separates the wait.
 *
 * WHY IT MIRRORS THE REAL LAYOUT RATHER THAN SPINNING
 *
 * A spinner says "something is happening somewhere". A skeleton says "three
 * pieces of work are about to appear here, in a list, in that shape" — and
 * because it occupies the same space the content will, nothing jumps when the
 * content lands. This project already learned that the expensive way: an
 * earlier skeleton that drew approximate shapes moved the page 110px on load,
 * and hand-matched heights still moved it 36px. The only version that cost
 * nothing was the one built from the same components as the real thing.
 *
 * THE PULSE IS DELIBERATELY SLOW
 *
 * 1.6s, not the 1s most libraries default to. A fast pulse on a screen someone
 * opens twenty times a day reads as urgency, and this is the opposite of an
 * urgent moment — it is the app not being ready yet.
 */

interface SkeletonProps {
  /** Height in the 4px scale, e.g. 4 = 16px. Matches the spacing tokens. */
  h?: number;
  /** Tailwind width class. Varying these is what stops rows looking printed. */
  w?: string;
  className?: string;
}

export function Skeleton({ h = 4, w = 'w-full', className = '' }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`skeleton block rounded-card ${w} ${className}`}
      style={{ height: `calc(var(--sp-1) * ${h})` }}
    />
  );
}

/**
 * A list of work, pending.
 *
 * `rows` should match what the screen usually holds, not a round number —
 * three is the median here, and a skeleton showing eight rows for a person who
 * has two is its own small lie about how much is waiting for them.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  // Widths vary per row so the block reads as text rather than as a table.
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-3/5', 'w-4/5'];

  return (
    <div
      // Announced once, rather than each row announcing itself.
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="flex flex-col gap-2 px-4"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-card border border-ink-600 bg-ink-800 px-4 py-3"
        >
          <Skeleton h={5} w="w-5" className="shrink-0 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton h={4} w={widths[i % widths.length]} />
            <Skeleton h={3} w="w-1/4" />
          </div>
        </div>
      ))}
      {/*
        The visible text a screen reader gets. Without it the live region
        announces nothing at all, because every child is aria-hidden.
      */}
      <span className="sr-only">Loading your work</span>
    </div>
  );
}
