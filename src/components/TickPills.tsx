import { useLayoutEffect, useRef } from 'react';
import { clearTick, drawTick, haptic } from '../lib/motion';
import { refillStatus, type ChecklistItem } from '../lib/checklist';

/**
 * Today's checklist as one row of tick pills.
 *
 * The checklist was a card of full-width rows above the day's work: three
 * items and their buttons cost 280 px, which on a phone pushed the first
 * deadline two screens down. Ticking is almost the only thing done with it on
 * Today, and a pill does that in a third of the height. Editing, adding and
 * back-filling a missed day live one tap away, behind the last pill, where
 * they are done less often and with more attention.
 *
 * The row scrolls rather than wraps, so it is one line however long the list
 * is; a wrapped row of pills grows exactly as the card it replaced did.
 *
 * The tick draws on as in CheckRow (rule 12). The pill is the whole target,
 * 44 px high, and a dose count rides inside it so the number meant to protect
 * you is still read at the moment of ticking.
 */
export function TickPills({
  items,
  isDone,
  onToggle,
  onOpenList,
  onAdd,
}: {
  items: ChecklistItem[];
  isDone: (id: string) => boolean;
  onToggle: (id: string) => void;
  /** The full list: edit, add, fill in a day. */
  onOpenList: () => void;
  /** An empty checklist's invitation. */
  onAdd: () => void;
}) {
  return (
    <div className="tick-pills" role="group" aria-label="Checklist">
      {items.length === 0 ? (
        <button type="button" className="tick-pill tick-pill-quiet" onClick={onAdd}>
          Add something you do every day
        </button>
      ) : (
        <>
          {items.map((item) => (
            <Pill key={item.id} item={item} done={isDone(item.id)} onToggle={() => onToggle(item.id)} />
          ))}
          <button
            type="button"
            className="tick-pill tick-pill-quiet"
            onClick={onOpenList}
            aria-label="Open the checklist to edit it, add to it or fill in a day"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
}

function Pill({ item, done, onToggle }: { item: ChecklistItem; done: boolean; onToggle: () => void }) {
  const tick = useRef<SVGPathElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const was = useRef(done);

  // On the transition only, so ticking one pill does not redraw the others.
  useLayoutEffect(() => {
    const becameDone = done && !was.current;
    const becameOpen = !done && was.current;
    was.current = done;
    if (becameDone && tick.current) drawTick(tick.current, box.current ?? undefined);
    if (becameOpen && box.current) clearTick(box.current);
  }, [done]);

  const refill = refillStatus(item);
  // The full refill sentence is in the checklist sheet; a pill carries the
  // count, and says "refill" when it is time.
  const meta = refill.doses === null ? null : refill.empty ? 'none left' : refill.needsRefill ? `${refill.doses} left · refill` : `${refill.doses} left`;

  return (
    <button
      type="button"
      className="tick-pill"
      aria-pressed={done}
      onClick={() => {
        if (!done) haptic();
        onToggle();
      }}
    >
      <span ref={box} aria-hidden className="tick" data-done={done || undefined}>
        {done && (
          <svg viewBox="0 0 12 12" className="h-3 w-3">
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
      <span className={done ? 'text-text-mid line-through decoration-text-low' : undefined}>{item.title}</span>
      {meta && <span className={`tick-pill-meta ${refill.needsRefill ? 'text-t-critical' : ''}`}>{meta}</span>}
    </button>
  );
}
