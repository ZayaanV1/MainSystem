import type { ReactNode } from 'react';

/**
 * A section's heading, in the ledger's manner.
 *
 * The title, then an optional count set in display numerals, then a hairline
 * that runs out to the right and fades — and anything the section needs to
 * offer (a day strip, an Add) pinned at the far end. It replaces a bare h2
 * floating over a card, which is the most default heading there is and gave
 * every screen the same shape as every other app's.
 *
 * The count is a fact about the section, never a score. "Work 7" says seven
 * things are open; nothing here ever counts what was missed.
 */
export function SectionHead({
  title,
  count,
  aside,
  id,
}: {
  title: string;
  /** How many things are in the section, when that helps. */
  count?: number | string | null;
  /** Controls that belong to the section, placed at the end of the rule. */
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="section-head">
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {count !== undefined && count !== null && count !== '' && (
        <span className="section-count" aria-label={`${count} ${count === 1 ? 'item' : 'items'}`}>
          {count}
        </span>
      )}
      <span aria-hidden className="section-rule" />
      {aside}
    </div>
  );
}
