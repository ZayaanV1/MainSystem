import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Sheet } from '../Sheet';
import { Button } from '../Button';
import { SIZE_NAME, SIZE_SPAN, SIZES, WIDGET_TYPES, defaultSize, photoCount, MAX_PHOTOS, MAX_WIDGETS, type Widget, type WidgetSize, type WidgetType } from '../../lib/board';
import { EASE } from '../../lib/motion';
import { CATEGORIES, INFO, SUGGESTED, matches } from './catalogue';
import { WidgetFrame } from './WidgetFrame';
import type { WidgetContext } from './widgets';

/**
 * The widget gallery: a sheet that slides up with suggestions, a search
 * field, and every widget filed by category, like the one on a phone's home
 * screen. Tap a widget to see it at every size; hold one, anywhere in here,
 * and it lifts out of the sheet onto the board, the sheet sliding away under
 * the finger.
 *
 * Every preview is the real widget drawn from the account's own data, at
 * the size it will have on the board (shrunk only when the sheet is
 * narrower than the board).
 */

type Spec = { type: WidgetType; size: WidgetSize; opts: Record<string, string> };

const HOLD_MS = 320;

const ICON: Record<WidgetType, string> = {
  due: 'M12 7v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z',
  work: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  now: 'M5 12h12M13 7l5 5-5 5',
  list: 'M5 7l2 2 3-3M5 15l2 2 3-3M13 8h6M13 16h6',
  class: 'M3 9l9-5 9 5-9 5zM7 11v5c3 2 7 2 10 0v-5',
  week: 'M3 5h18v15H3zM3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2',
  month: 'M3 5h18v15H3zM3 10h18M8 3v4M16 3v4M7 13h1M11 13h1M15 13h1M7 16.5h1M11 16.5h1',
  agenda: 'M7 3v18M7 7h11v5H7M7 15h7v4H7',
  exams: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7v5h4',
  clockday: 'M9 6a6 6 0 1 0 0 12A6 6 0 0 0 9 6ZM9 9v3h2.5M17 7h4M17 12h4M17 17h4',
  count: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9',
  focus: 'M12 5.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM12 9v4l2.5 2.5M10 2h4',
  term: 'M3 17h18M5 17V9M9 17v-5M13 17V7M17 17v-3',
  goal: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 11v2',
  grades: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  capture: 'M12 8v8M8 12h8M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z',
  photo: 'M3 5h18v14H3zM21 16l-5-5-8 8M9 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
};

export function Gallery({
  board,
  ctx,
  onClose,
  onAdd,
  onLift,
  cellFor,
}: {
  board: Widget[];
  ctx: WidgetContext;
  onClose: () => void;
  onAdd: (spec: Spec) => void;
  onLift: (spec: Spec, x: number, y: number, grab: { fx: number; fy: number }) => void;
  cellFor: () => number;
}) {
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<WidgetType | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(80);
  const gap = 12;

  // Previews at the board's own size, or smaller when the sheet is narrower.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => setCell(Math.min(cellFor(), (el.clientWidth - 3 * gap) / 4));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cellFor]);

  // The lift hides the whole sheet; it is shown again only once it has gone.
  useEffect(() => () => document.documentElement.removeAttribute('data-board-lift'), []);

  const full = board.length >= MAX_WIDGETS;
  const photosFull = photoCount(board) >= MAX_PHOTOS;
  const blocked = (t: WidgetType) => full || (t === 'photo' && photosFull);
  const off = (t: WidgetType) => (t === 'now' && !ctx.assistOn) || (t === 'grades' && !ctx.gradesOn);

  /* ---------------------------------------------- hold to lift it out --- */

  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; last: { x: number; y: number } } | null>(null);
  const lifted = useRef(false);

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, spec: Spec) {
    if (e.button !== 0 || blocked(spec.type) || off(spec.type)) return;
    const src = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    const track = (ev: PointerEvent) => {
      if (!pending.current) return;
      pending.current.last = { x: ev.clientX, y: ev.clientY };
      // Moving first means scrolling the sheet, not lifting.
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) cancel();
    };
    const cancel = () => {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      src.removeAttribute('data-held');
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
    };
    src.setAttribute('data-held', '');
    pending.current = {
      x: start.x,
      y: start.y,
      last: start,
      timer: setTimeout(() => {
        const at = pending.current?.last ?? start;
        cancel();
        lifted.current = true;
        const preview = src.querySelector<HTMLElement>('.bw-w');
        let grab = { fx: 0.5, fy: 0.3 };
        if (preview) {
          const r = preview.getBoundingClientRect();
          grab = { fx: Math.min(1, Math.max(0, (at.x - r.left) / r.width)), fy: Math.min(1, Math.max(0, (at.y - r.top) / r.height)) };
        }
        slideAway();
        onLift(spec, at.x, at.y, grab);
      }, HOLD_MS),
    };
    window.addEventListener('pointermove', track);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
  }

  /** The sheet sinks out from under the finger and the scrim lifts. */
  function slideAway() {
    const panel = root.current?.closest<HTMLElement>('.sheet-panel');
    const scrim = panel?.parentElement?.querySelector<HTMLElement>('.sheet-scrim');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timing: KeyframeAnimationOptions = { duration: still ? 160 : 320, easing: EASE.glide, fill: 'forwards' };
    panel?.animate(still ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'none' }, { transform: 'translateY(105%)' }], timing);
    scrim?.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    document.documentElement.setAttribute('data-board-lift', '');
  }

  const click = (fn: () => void) => () => {
    if (lifted.current) {
      lifted.current = false;
      return;
    }
    fn();
  };

  // A widget arrives ready where it can: a clock with a face, a goal widget
  // showing the account's first goal.
  const firstGoal = ctx.goals?.[0]?.id;
  const spec = (type: WidgetType, size: WidgetSize = defaultSize(type), opts: Record<string, string> = {}): Spec => ({
    type,
    size,
    opts:
      type === 'clock' && !opts.face
        ? { ...opts, face: 'analog' }
        : type === 'goal' && !opts.goal && firstGoal
          ? { ...opts, goal: firstGoal }
          : opts,
  });

  const preview = (s: Spec) => <WidgetFrame w={{ id: `pv-${s.type}-${s.size}`, ...s }} ctx={ctx} fixed />;

  const types = WIDGET_TYPES.filter((t) => matches(t, query));
  const row = (t: WidgetType) => {
    const i = INFO[t];
    const s = spec(t);
    return (
      <li key={t}>
        <button
          type="button"
          className="bw-grow-row"
          disabled={off(t)}
          onPointerDown={(e) => onPointerDown(e, s)}
          onClick={click(() => setDetail(t))}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="mat bw-ic" aria-hidden>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[t]} /></svg>
          </span>
          <span className="bw-gtext">
            <span className="bw-gname">{i.name}</span>
            <span className="bw-gdesc type-note">{off(t) ? 'Switched off in Settings' : i.desc}</span>
          </span>
          <span className="bw-gsz">{SIZES[t].length} {SIZES[t].length === 1 ? 'size' : 'sizes'} ›</span>
        </button>
      </li>
    );
  };

  return (
    <Sheet open onClose={onClose} title={detail ? INFO[detail].name : 'Widgets'}>
      <div ref={root} className="bw-gallery" style={{ '--cell': `${cell}px`, '--bw-gap': `${gap}px` } as CSSProperties}>
        {detail ? (
          <Detail
            type={detail}
            blocked={blocked(detail)}
            onBack={() => setDetail(null)}
            onAdd={onAdd}
            preview={preview}
            onPointerDown={onPointerDown}
            spec={spec}
            full={full}
            photosFull={photosFull}
          />
        ) : (
          <div className="bw-pane" key="list">
            <label className="bw-search">
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <span className="sr-only">Search widgets</span>
              <input className="well" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search widgets" autoComplete="off" enterKeyHint="search" />
            </label>
            {full && <p className="type-note bw-hint">The board is full. Remove a widget to add another.</p>}
            {!query.trim() && (
              <>
                <p className="type-note bw-ghint">Hold a widget and drag it onto your board, or tap one to see its sizes.</p>
                <div className="bw-feat">
                  {SUGGESTED.filter((s) => !off(s.type)).map((s) => {
                    const sp = spec(s.type, s.size, s.opts);
                    return (
                      <div
                        key={`${s.type}-${s.size}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${INFO[s.type].name}. Hold to drag onto the board.`}
                        className="bw-gi"
                        onPointerDown={(e) => onPointerDown(e, sp)}
                        onClick={click(() => setDetail(s.type))}
                        onKeyDown={(e) => e.key === 'Enter' && setDetail(s.type)}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        {preview(sp)}
                        <span className="bw-gcap">{INFO[s.type].name}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {query.trim() ? (
              types.length ? (
                <>
                  <h3 className="kicker bw-cat">Results</h3>
                  <ul className="bw-glist">{types.map(row)}</ul>
                </>
              ) : (
                <p className="type-note bw-ghint">No widgets match “{query.trim()}”. Try calendar, timer or music.</p>
              )
            ) : (
              CATEGORIES.map((c) => (
                <div key={c}>
                  <h3 className="kicker bw-cat">{c}</h3>
                  <ul className="bw-glist">{types.filter((t) => INFO[t].cat === c).map(row)}</ul>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** One widget at every size it comes in: swipe between them, hold one to drag it, or Add. */
function Detail({
  type,
  blocked,
  onBack,
  onAdd,
  preview,
  onPointerDown,
  spec,
  full,
  photosFull,
}: {
  type: WidgetType;
  blocked: boolean;
  onBack: () => void;
  onAdd: (spec: Spec) => void;
  preview: (s: Spec) => ReactNode;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, s: Spec) => void;
  spec: (t: WidgetType, size?: WidgetSize, opts?: Record<string, string>) => Spec;
  full: boolean;
  photosFull: boolean;
}) {
  const sizes = SIZES[type];
  const [index, setIndex] = useState(() => Math.max(0, sizes.indexOf(defaultSize(type))));
  const [face, setFace] = useState('analog');
  const slides = useRef<HTMLDivElement>(null);
  const opts: Record<string, string> = type === 'clock' ? { face } : {};

  useLayoutEffect(() => {
    const el = slides.current;
    if (el) el.scrollLeft = index * el.clientWidth;
    // Only on opening: after that the scroll position is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const size = sizes[index];
  return (
    <div className="bw-pane bw-detail" key="detail">
      <div className="bw-detail-bar">
        <Button variant="quiet" size="sm" onClick={onBack}>‹ Widgets</Button>
        <Button variant="primary" size="sm" disabled={blocked} onClick={() => onAdd(spec(type, size, opts))}>
          Add
        </Button>
      </div>
      <p className="type-note bw-ghint">{INFO[type].desc}.</p>
      <div
        ref={slides}
        className="bw-slides"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== index && i >= 0 && i < sizes.length) setIndex(i);
        }}
      >
        {sizes.map((s) => {
          const sp = spec(type, s, opts);
          return (
            <div key={s} className="bw-slide">
              <div
                className="bw-gi"
                role="button"
                tabIndex={-1}
                aria-label={`${SIZE_NAME[s]}. Hold to drag onto the board.`}
                onPointerDown={(e) => onPointerDown(e, sp)}
                onContextMenu={(e) => e.preventDefault()}
              >
                {preview(sp)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="bw-dots" role="tablist" aria-label="Sizes">
        {sizes.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={SIZE_NAME[s]}
            onClick={() => slides.current?.scrollTo({ left: i * slides.current.clientWidth, behavior: 'smooth' })}
          />
        ))}
      </div>
      <p className="bw-szlabel">
        <b>{SIZE_NAME[size]}</b> · {SIZE_SPAN[size][0]} × {SIZE_SPAN[size][1]}
      </p>
      {type === 'clock' && (
        <div className="bw-field">
          <span className="type-label">Face</span>
          <div className="bw-chips" role="group" aria-label="Clock face">
            {[['analog', 'Analog'], ['digital', 'Digital'], ['flip', 'Flip'], ['dot', 'Dot matrix']].map(([v, l]) => (
              <button key={v} type="button" className="chip" aria-pressed={face === v} onClick={() => setFace(v)}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {full && <p className="type-note bw-hint">The board is full. Remove a widget to add another.</p>}
      {!full && type === 'photo' && photosFull && <p className="type-note bw-hint">A board holds {MAX_PHOTOS} photos. Remove one to add another.</p>}
    </div>
  );
}
