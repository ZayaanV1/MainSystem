import { useLayoutEffect, useRef } from 'react';
import type { Widget } from '../../lib/board';
import { BLEED, WidgetBody, type WidgetContext } from './widgets';
import { INFO } from './catalogue';

/**
 * Hide every list row that does not fit whole inside the widget.
 *
 * A fixed row count per size was wrong in both directions: a theme with a
 * taller face cut the last row in half, and one with a compact face left
 * space empty. Measuring is the only rule that holds across ten themes and
 * six sizes. A row is hidden, never shrunk, and a hidden row hides the rows
 * after it, so a list never skips one.
 */
function fitRows(inner: HTMLElement) {
  fitTitles(inner);
  const lists = inner.querySelectorAll<HTMLElement>('ul');
  if (!lists.length) return;
  const rows: HTMLElement[] = [];
  lists.forEach((ul) => ul.querySelectorAll<HTMLElement>(':scope > li').forEach((li) => rows.push(li)));
  rows.forEach((li) => (li.style.display = ''));
  const box = inner.getBoundingClientRect();
  const floor = box.bottom - parseFloat(getComputedStyle(inner).paddingBottom || '0') + 0.5;
  lists.forEach((ul) => {
    const limit = Math.min(floor, ul.getBoundingClientRect().bottom + 0.5);
    let cut = false;
    ul.querySelectorAll<HTMLElement>(':scope > li').forEach((li, i) => {
      // The first row always shows; a widget too small for even one row is
      // a size the type does not offer.
      if (!cut && i > 0 && li.getBoundingClientRect().bottom > limit) cut = true;
      if (cut) li.style.display = 'none';
    });
  });
}

/**
 * A title is allowed two lines, and gives one back when the widget would
 * otherwise push its last line out of the bottom: "Problem set 4:
 * interference" on two lines left no room for when it is due. Measured, for
 * the same reason as the rows: what fits depends on the title and the theme.
 */
function fitTitles(inner: HTMLElement) {
  const titles = inner.querySelectorAll<HTMLElement>('.bw-t2');
  if (!titles.length) return;
  titles.forEach((t) => t.style.removeProperty('-webkit-line-clamp'));
  // Anything spilling past the widget's padding, at any depth (a title in
  // the column of a split widget too). Lists clip themselves and are fitted
  // by row, so they do not count here.
  const pad = parseFloat(getComputedStyle(inner).paddingBottom || '0');
  const floor = inner.getBoundingClientRect().bottom - pad + 0.5;
  const over = Array.from(inner.querySelectorAll<HTMLElement>('.bw-t2, .bw-meta, .bw-unit')).some(
    (el) => !el.closest('ul') && el.getBoundingClientRect().bottom > floor,
  );
  if (!over) return;
  titles.forEach((t) => t.style.setProperty('-webkit-line-clamp', '1'));
}

/**
 * One widget on the board, in the gallery or in the hand: the themed surface
 * (the app's own material, so it follows every theme), its contents, and in
 * edit mode the remove control.
 */
export function WidgetFrame({
  w,
  ctx,
  slot = false,
  fixed = false,
  onRemove,
}: {
  w: Widget;
  ctx: WidgetContext;
  slot?: boolean;
  fixed?: boolean;
  onRemove?: () => void;
}) {
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || slot) return;
    let frame = 0;
    // The widget and each list in it are watched for size: a theme switch
    // changes the face and so the room a list has, without resizing the
    // widget. Re-hiding the same rows ends at the same size, so this settles.
    const size = new ResizeObserver(() => run());
    const watch = () => {
      size.observe(el);
      el.querySelectorAll('ul').forEach((ul) => size.observe(ul));
    };
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        watch();
        fitRows(el);
      });
    };
    watch();
    fitRows(el);
    // Content changes (a row ticked off, data arriving) change what fits too,
    // and are fitted at once rather than on the next frame, so no frame shows
    // a half row. Only child lists and text are watched, so hiding a row does
    // not trigger itself.
    const content = new MutationObserver(() => {
      watch();
      fitRows(el);
    });
    content.observe(el, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(run);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      content.disconnect();
    };
  }, [slot]);
  return (
    <div className={`bw-w bw-${w.size}${fixed ? ' bw-fx' : ''}`} data-id={w.id} data-type={w.type} data-slot={slot || undefined}>
      <div ref={inner} className={`mat mat-raised bw-in${BLEED.has(w.type) ? ' bw-bleed' : ''}`}>{!slot && <WidgetBody w={w} ctx={ctx} />}</div>
      {onRemove && !slot && (
        <button type="button" className="bw-rm" aria-label={`Remove ${INFO[w.type].name}`} onClick={onRemove}>
          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"><path d="M6 12h12" /></svg>
        </button>
      )}
    </div>
  );
}
