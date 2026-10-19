import type { Widget } from '../../lib/board';
import { BLEED, WidgetBody, type WidgetContext } from './widgets';
import { INFO } from './catalogue';

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
  return (
    <div className={`bw-w bw-${w.size}${fixed ? ' bw-fx' : ''}`} data-id={w.id} data-type={w.type} data-slot={slot || undefined}>
      <div className={`mat mat-raised bw-in${BLEED.has(w.type) ? ' bw-bleed' : ''}`}>{!slot && <WidgetBody w={w} ctx={ctx} />}</div>
      {onRemove && !slot && (
        <button type="button" className="bw-rm" aria-label={`Remove ${INFO[w.type].name}`} onClick={onRemove}>
          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"><path d="M6 12h12" /></svg>
        </button>
      )}
    </div>
  );
}
