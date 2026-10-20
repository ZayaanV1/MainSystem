import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/board.css';
import {
  adoptBoard,
  BOARD_EVENT,
  insertionIndex,
  moveWidget,
  newWidgetId,
  saveBoard,
  useBoard,
  type Box,
  type Widget,
  type WidgetSize,
  type WidgetType,
} from '../../lib/board';
import type { Assignment, TodayData } from '../../lib/planner';
import { capture, loadWeightedWork } from '../../lib/planner';
import type { ChecklistItem } from '../../lib/checklist';
import { loadGoals, updateGoal, type Goal } from '../../lib/goals';
import { termSpan } from '../../lib/classes';
import { removePhotos } from '../../lib/boardPhotos';
import { moduleOn, usePreferences } from '../../lib/preferences';
import { EASE, haptic, restorePage } from '../../lib/motion';
import { announce } from '../../lib/announce';
import type { DayKey } from '../../lib/time';
import { SheetPresence } from '../Sheet';
import { Button } from '../Button';
import { type Term, type WidgetContext } from './widgets';
import { WidgetFrame } from './WidgetFrame';
import { INFO } from './catalogue';

const Gallery = lazy(() => import('./Gallery').then((m) => ({ default: m.Gallery })));
const WidgetConfig = lazy(() => import('./WidgetConfig').then((m) => ({ default: m.WidgetConfig })));

/**
 * The widget board: Today's first section, a grid four cells wide that the
 * account fills from the widget gallery (built from the approved "Today
 * Pegboard" prototype, Oct 2026).
 *
 * HOW MOVING WORKS
 *
 * Hold a widget still for a moment and it lifts, the way an app does on a
 * phone's home screen; from then on it follows the finger. Every widget it
 * passes over makes room, but only after the finger has rested for a beat
 * (SETTLE_MS), so a widget carried across the board does not shuffle
 * everything it crosses. The neighbours glide to their new places from
 * where they were (a FLIP played by the browser), and letting go settles
 * the widget into the space that opened. A widget held from the gallery
 * does the same: the gallery slides away beneath it and the board opens a
 * space wherever it hovers.
 *
 * The page cannot scroll under a finger that is carrying something, so the
 * board scrolls itself when the finger nears the top or bottom of the
 * screen.
 */

const HOLD_MS = 420;
const SETTLE_MS = 170;
const SLOT = '__slot';

export interface BoardProps {
  userId: string;
  data: TodayData | null;
  today: DayKey;
  now: Date;
  /** Today's checklist items; null while loading. */
  checklist: ChecklistItem[] | null;
  isDone: (itemId: string) => boolean;
  onToggleItem: (id: string) => void;
  onFinish: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
  sized: (minutes: number | null) => number | null;
  onUndoable: (u: { message: string; undo: () => void }) => void;
}

interface Drag {
  mode: 'move' | 'new';
  id: string;
  x: number;
  y: number;
  x0: number;
  y0: number;
  /** Where in the widget it was grabbed. */
  gx: number;
  gy: number;
  moved: boolean;
  fromHold: boolean;
  lastSwap: number;
  widget?: Widget;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Run `then` when the animation ends, or after `ms` if it never does. A tab
 * in the background holds animations where they are, and a widget left
 * half-landed or half-removed because a promise never settled is a board
 * that no longer matches what was saved.
 */
function whenDone(anim: Animation, ms: number, then: () => void) {
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    then();
  };
  void anim.finished.then(once, once);
  setTimeout(once, ms + 80);
}

export function Board(props: BoardProps) {
  const { userId, data, today, now } = props;
  const prefs = usePreferences();
  const board = useBoard();
  const [draft, setDraft] = useState<Widget[] | null>(null);
  const list = draft ?? board;
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [floater, setFloater] = useState<{ widget: Widget; cell: number; at: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const grid = useRef<HTMLDivElement>(null);
  const floaterEl = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const raf = useRef(0);
  const handlers = useRef<{ onMove: (e: PointerEvent) => void; onUp: () => void }>({ onMove: () => {}, onUp: () => {} });

  // Today's ⋯ menu opens the gallery or editing (BOARD_EVENT). The board has
  // no toolbar of its own at rest: two buttons above the widgets were the
  // first thing on the screen and the least often used.
  useEffect(() => {
    const on = (e: Event) => {
      const what = (e as CustomEvent<'edit' | 'add'>).detail;
      if (what === 'add') setGallery(true);
      else setEditing(true);
    };
    window.addEventListener(BOARD_EVENT, on);
    return () => window.removeEventListener(BOARD_EVENT, on);
  }, []);

  useEffect(() => {
    void adoptBoard();
  }, []);

  /* --------------------------------------------- data some widgets need --- */

  const has = (t: WidgetType) => list.some((w) => w.type === t);
  const wantsGoals = has('goal') || gallery || configId !== null;
  const wantsGrades = has('grades') || gallery;
  const wantsTerm = has('term') || gallery;

  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [goalsFailed, setGoalsFailed] = useState(false);
  const reloadGoals = useCallback(() => {
    void loadGoals().then(({ goals: g, error }) => {
      setGoals(g);
      setGoalsFailed(Boolean(error));
    });
  }, []);
  useEffect(() => {
    if (wantsGoals && goals === null) reloadGoals();
  }, [wantsGoals, goals, reloadGoals]);

  const [grades, setGrades] = useState<WidgetContext['grades']>(null);
  useEffect(() => {
    if (!wantsGrades || grades !== null) return;
    void loadWeightedWork().then((r) => setGrades({ rows: [...r.rows, ...r.events], failed: r.failed }));
  }, [wantsGrades, grades]);

  const [term, setTerm] = useState<Term | null | undefined>(undefined);
  useEffect(() => {
    if (!wantsTerm || term !== undefined) return;
    void termSpan(today).then(({ span }) => setTerm(span));
  }, [wantsTerm, term, today]);

  const stepGoal = useCallback(
    (g: Goal) => {
      if (g.have >= g.target) return;
      const next = g.have + 1;
      setGoals((gs) => gs?.map((x) => (x.id === g.id ? { ...x, have: next } : x)) ?? gs);
      announce(`${g.title}: ${next} of ${g.target}`);
      void updateGoal(g.id, { have: next }).then(({ error }) => {
        if (!error) return;
        setGoals((gs) => gs?.map((x) => (x.id === g.id ? { ...x, have: g.have } : x)) ?? gs);
        setSaveError(error);
      });
    },
    [],
  );

  const ctx = useMemo<WidgetContext>(
    () => ({
      userId,
      today,
      now,
      assignments: data?.assignments ?? null,
      events: data?.events ?? null,
      courses: data?.courses ?? [],
      inbox: data?.inbox ?? [],
      deferrals: data?.deferrals ?? {},
      checklist: props.checklist,
      isDone: props.isDone,
      onToggleItem: props.onToggleItem,
      onFinish: props.onFinish,
      onOpen: props.onOpen,
      sized: props.sized,
      capture: (body) => capture(userId, body),
      goals,
      goalsFailed,
      onGoalStep: stepGoal,
      grades,
      term,
      assistOn: moduleOn('assist', prefs),
      gradesOn: moduleOn('grades', prefs),
      still: false,
    }),
    [userId, today, now, data, props.checklist, props.isDone, props.onToggleItem, props.onFinish, props.onOpen, props.sized, goals, goalsFailed, stepGoal, grades, term, prefs],
  );
  const stillCtx = useMemo(() => ({ ...ctx, still: true }), [ctx]);

  /* ------------------------------------------------------------ saving --- */

  const commit = useCallback(
    (next: Widget[]) => {
      setSaveError(null);
      void saveBoard(userId, next.filter((w) => w.id !== SLOT)).then(({ error }) => error && setSaveError(error));
    },
    [userId],
  );

  /* ------------------------------------------------ layout animation ---- */

  const els = () => (grid.current ? [...grid.current.querySelectorAll<HTMLElement>(':scope > .bw-w')] : []);
  const snapshot = () => {
    const m = new Map<string, DOMRect>();
    for (const el of els()) m.set(el.dataset.id!, el.getBoundingClientRect());
    return m;
  };

  /** Change the board, and play every widget from where it was to where it lands. */
  const reflow = useCallback((next: Widget[] | null, asDraft: boolean) => {
    before.current = snapshot();
    if (asDraft) setDraft(next);
    else {
      setDraft(null);
      if (next) commit(next);
    }
    // snapshot is read fresh each call; commit is stable per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    if (drag.current?.mode === 'move' && drag.current.moved) placeMoving();
    if (!first || reduced()) return;
    for (const el of els()) {
      const id = el.dataset.id!;
      if (drag.current?.mode === 'move' && id === drag.current.id && drag.current.moved) continue;
      const a = first.get(id);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: EASE.glide });
    }
  });

  /* ------------------------------------------------------------- drag --- */

  function placeMoving() {
    const d = drag.current;
    if (!d || d.mode !== 'move') return;
    const el = grid.current?.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(d.id)}"]`);
    if (!el) return;
    el.style.translate = 'none';
    const r = el.getBoundingClientRect();
    el.style.translate = `${d.x - d.gx - r.left}px ${d.y - d.gy - r.top}px`;
  }

  function hover() {
    const d = drag.current;
    if (!d || !grid.current) return;
    if (d.mode === 'move') placeMoving();
    else if (floaterEl.current) floaterEl.current.style.translate = `${d.x - d.gx}px ${d.y - d.gy}px`;
    const br = grid.current.getBoundingClientRect();
    if (d.x < br.left - 40 || d.x > br.right + 40 || d.y < br.top - 80 || d.y > br.bottom + 80) return;
    const t = performance.now();
    if (t - d.lastSwap < SETTLE_MS) return;
    const current = draft ?? board;
    const boxes: Box[] = els().map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id!, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const at = insertionIndex(boxes, d.x, d.y, d.id, br.width);
    const from = current.findIndex((w) => w.id === d.id);
    const withoutIndex = current.filter((w) => w.id !== d.id);
    if (from >= 0 && withoutIndex[at - 1]?.id === current[from - 1]?.id && withoutIndex[at]?.id === current[from + 1]?.id) return;
    d.lastSwap = t;
    reflow(moveWidget(current, d.id, at), true);
  }
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

  function autoScroll() {
    raf.current = 0;
    const d = drag.current;
    if (!d || !d.moved) return;
    const edge = 90;
    let v = 0;
    if (d.y < edge) v = -Math.ceil((edge - d.y) / 6);
    else if (d.y > innerHeight - edge) v = Math.ceil((d.y - (innerHeight - edge)) / 6);
    if (v) {
      scrollBy(0, v);
      hoverRef.current();
      raf.current = requestAnimationFrame(autoScroll);
    }
  }

  /*
   * The window listeners are added once per gesture and must be removed with
   * the same function identities, so they are stable wrappers around the
   * latest handlers rather than the handlers of whichever render added them.
   */
  const stable = useRef({
    move: (e: PointerEvent) => handlers.current.onMove(e),
    up: () => handlers.current.onUp(),
    // A finger carrying a widget must not scroll the page under it.
    touch: (e: TouchEvent) => {
      if (drag.current?.moved) e.preventDefault();
    },
  }).current;

  function listen() {
    window.addEventListener('pointermove', stable.move);
    window.addEventListener('pointerup', stable.up);
    window.addEventListener('pointercancel', stable.up);
    document.addEventListener('touchmove', stable.touch, { passive: false });
  }
  function unlisten() {
    window.removeEventListener('pointermove', stable.move);
    window.removeEventListener('pointerup', stable.up);
    window.removeEventListener('pointercancel', stable.up);
    document.removeEventListener('touchmove', stable.touch);
  }

  function onMove(e: PointerEvent) {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
      clearTimeout(p.timer);
      press.current = null;
      if (!drag.current) unlisten();
    }
    const d = drag.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) < 7) return;
      lift(d);
    }
    hoverRef.current();
    if (!raf.current) raf.current = requestAnimationFrame(autoScroll);
  }

  function lift(d: Drag) {
    d.moved = true;
    const el = grid.current?.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(d.id)}"]`);
    el?.setAttribute('data-lifted', '');
    haptic();
  }

  function onUp() {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
    unlisten();
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    const d = drag.current;
    drag.current = null;
    // A lift swallows the click that ends it; forget it if the browser sends none.
    setTimeout(() => (swallowClick.current = false), 0);
    if (!d) return;
    if (d.mode === 'move') {
      const el = grid.current?.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(d.id)}"]`);
      if (!d.moved) {
        if (!d.fromHold) setConfigId(d.id);
        return;
      }
      if (el) {
        const from = el.style.translate || '0px 0px';
        el.removeAttribute('data-lifted');
        el.style.translate = '';
        if (!reduced()) el.animate([{ translate: from }, { translate: '0px 0px' }], { duration: 340, easing: EASE.settle });
      }
      const next = draft ?? board;
      setDraft(null);
      commit(next);
      return;
    }
    land(d);
  }

  /** The widget from the gallery flies into its space and becomes real. */
  function land(d: Drag) {
    const slot = grid.current?.querySelector<HTMLElement>(`:scope > [data-id="${SLOT}"]`);
    const real: Widget = { ...d.widget!, id: newWidgetId() };
    const finish = () => {
      setFloater(null);
      setGallery(false);
      const next = (draft ?? board).map((w) => (w.id === SLOT ? real : w));
      setDraft(null);
      commit(next);
      announce(`${INFO[real.type].name} added`);
      props.onUndoable({
        message: `${INFO[real.type].name} added`,
        undo: () => remove(real.id, true),
      });
    };
    const fl = floaterEl.current;
    if (slot && fl && !reduced()) {
      const r = slot.getBoundingClientRect();
      fl.setAttribute('data-landing', '');
      const anim = fl.animate([{ translate: fl.style.translate }, { translate: `${r.left}px ${r.top}px` }], {
        duration: 360,
        easing: EASE.settle,
        fill: 'forwards',
      });
      whenDone(anim, 360, finish);
    } else finish();
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || drag.current) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.bw-w');
    if (!el || (e.target as HTMLElement).closest('.bw-rm, input, textarea')) return;
    const r = el.getBoundingClientRect();
    const base: Drag = {
      mode: 'move',
      id: el.dataset.id!,
      x: e.clientX,
      y: e.clientY,
      x0: e.clientX,
      y0: e.clientY,
      gx: e.clientX - r.left,
      gy: e.clientY - r.top,
      moved: false,
      fromHold: false,
      lastSwap: 0,
    };
    if (editing) {
      drag.current = base;
      listen();
      return;
    }
    // Not editing: a finger held still lifts it, as on a phone's home screen.
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        swallowClick.current = true;
        setEditing(true);
        const d: Drag = { ...base, x: base.x, y: base.y, fromHold: true };
        drag.current = d;
        lift(d);
        placeMoving();
      }, HOLD_MS),
    };
    listen();
  }

  // Keep the latest handlers reachable from the window listeners.
  handlers.current = { onMove, onUp };
  useEffect(() => () => unlisten(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Held in the gallery: the gallery slides away and the widget follows the finger onto the board. */
  const onLift = useCallback(
    (spec: { type: WidgetType; size: WidgetSize; opts: Record<string, string> }, x: number, y: number, grab: { fx: number; fy: number }) => {
      if (!grid.current) return;
      const cell = parseFloat(getComputedStyle(grid.current).gridTemplateColumns.split(' ')[0]) || 80;
      const widget: Widget = { id: SLOT, ...spec };
      restorePage();
      document.body.style.overflow = '';
      haptic();
      setEditing(true);
      const gap = parseFloat(getComputedStyle(grid.current).columnGap) || 12;
      const [c, rws] = { peg: [1, 1], strip: [4, 1], s: [2, 2], tall: [2, 4], m: [4, 2], l: [4, 4] }[spec.size];
      const w = c * cell + (c - 1) * gap;
      const h = rws * cell + (rws - 1) * gap;
      const d: Drag = { mode: 'new', id: SLOT, x, y, x0: x, y0: y, gx: grab.fx * w, gy: grab.fy * h, moved: true, fromHold: true, lastSwap: -1e9, widget };
      drag.current = d;
      setFloater({ widget, cell, at: `${x - d.gx}px ${y - d.gy}px` });
      reflow([...(draft ?? board), widget], true);
      listen();
      requestAnimationFrame(() => hoverRef.current());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, draft],
  );

  /** Tap Add in the gallery: the widget goes on top and the board makes room. */
  const onAdd = useCallback(
    (spec: { type: WidgetType; size: WidgetSize; opts: Record<string, string> }) => {
      const w: Widget = { id: newWidgetId(), ...spec };
      setGallery(false);
      setEditing(true);
      reflow([w, ...board], false);
      announce(`${INFO[w.type].name} added`);
      props.onUndoable({ message: `${INFO[w.type].name} added`, undo: () => remove(w.id, true) });
      requestAnimationFrame(() => {
        const el = grid.current?.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(w.id)}"]`);
        el?.setAttribute('data-arrive', '');
        el?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board],
  );

  /** Remove with an exit, the rest closing up behind it, and an undo. */
  function remove(id: string, quiet = false) {
    const current = boardRef.current;
    const at = current.findIndex((w) => w.id === id);
    if (at < 0) return;
    const gone = current[at];
    const el = grid.current?.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(id)}"]`);
    const done = () => {
      const next = boardRef.current.filter((w) => w.id !== id);
      reflow(next, false);
      if (quiet) return;
      announce(`${INFO[gone.type].name} removed`);
      props.onUndoable({
        message: `${INFO[gone.type].name} removed`,
        undo: () => reflow([...boardRef.current.slice(0, at), gone, ...boardRef.current.slice(at)], false),
      });
      // A photo's file goes once the undo has had its chance.
      if (gone.type === 'photo' && gone.opts.path) {
        const path = gone.opts.path;
        setTimeout(() => {
          if (!boardRef.current.some((w) => w.opts.path === path)) void removePhotos([path]);
        }, 9000);
      }
    };
    if (el) {
      const anim = el.animate(
        reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6)' }],
        { duration: 190, easing: EASE.exit, fill: 'forwards' },
      );
      whenDone(anim, 190, done);
    } else done();
  }
  const boardRef = useRef(board);
  boardRef.current = board;

  const updateWidget = useCallback(
    (next: Widget) => {
      const sizeChanged = boardRef.current.find((w) => w.id === next.id)?.size !== next.size;
      const list2 = boardRef.current.map((w) => (w.id === next.id ? next : w));
      if (sizeChanged) reflow(list2, false);
      else commit(list2);
    },
    [commit, reflow],
  );

  const configured = configId ? board.find((w) => w.id === configId) ?? null : null;

  return (
    <section aria-label="Widgets" className="bw-section">
      {editing && (
        <>
          <div className="bw-bar enter-fade">
            <span className="kicker">Editing widgets</span>
            <span className="bw-bar-actions">
              <button type="button" className="btn btn-quiet btn-icon bw-add" aria-label="Add a widget" onClick={() => setGallery(true)}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <Button variant="primary" size="sm" onClick={() => setEditing(false)}>
                Done
              </Button>
            </span>
          </div>
          <p className="type-note bw-hint">Drag to move. Tap a widget to change it.</p>
        </>
      )}
      {saveError && <p role="alert" className="type-note bw-hint bw-error">{saveError}</p>}

      <div
        ref={grid}
        className="bw-grid"
        data-editing={editing || undefined}
        onPointerDown={onPointerDown}
        onClickCapture={(e) => {
          if (swallowClick.current || editing) {
            if ((e.target as HTMLElement).closest('.bw-rm')) return;
            e.preventDefault();
            e.stopPropagation();
            swallowClick.current = false;
          }
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.bw-w')) e.preventDefault();
        }}
      >
        {list.length === 0 && !editing && (
          <button type="button" className="bw-empty type-note" onClick={() => setGallery(true)}>
            Your board is empty. Add a widget.
          </button>
        )}
        {list.map((w) => (
          <WidgetFrame key={w.id} w={w} ctx={editing ? stillCtx : ctx} slot={w.id === SLOT} onRemove={() => remove(w.id)} />
        ))}
      </div>

      {floater &&
        createPortal(
          <div ref={floaterEl} className="bw-floater" style={{ '--cell': `${floater.cell}px`, translate: floater.at } as CSSProperties}>
            <WidgetFrame w={floater.widget} ctx={stillCtx} fixed />
          </div>,
          document.body,
        )}

      <SheetPresence>
        {gallery && (
          <Suspense fallback={null}>
            <Gallery
              board={board}
              ctx={stillCtx}
              onClose={() => setGallery(false)}
              onAdd={onAdd}
              onLift={onLift}
              cellFor={() => (grid.current ? parseFloat(getComputedStyle(grid.current).gridTemplateColumns.split(' ')[0]) || 80 : 80)}
            />
          </Suspense>
        )}
      </SheetPresence>
      <SheetPresence>
        {configured && (
          <Suspense fallback={null}>
            <WidgetConfig
              userId={userId}
              widget={configured}
              board={board}
              ctx={stillCtx}
              goals={goals}
              onGoalsChange={setGoals}
              onChange={updateWidget}
              onRemove={() => {
                const id = configured.id;
                setConfigId(null);
                remove(id);
              }}
              onClose={() => setConfigId(null)}
              cell={grid.current ? parseFloat(getComputedStyle(grid.current).gridTemplateColumns.split(' ')[0]) || 80 : 80}
            />
          </Suspense>
        )}
      </SheetPresence>
    </section>
  );

}
