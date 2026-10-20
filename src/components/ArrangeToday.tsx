import { useLayoutEffect, useRef, useState } from 'react';
import {
  ALWAYS_SHOWN,
  MODULES,
  TODAY_SECTIONS,
  saveModulesOff,
  saveTodayLayout,
  usePreferences,
  type Module,
  type TodaySection,
} from '../lib/preferences';
import { closeUp, measureBelow } from '../lib/motion';
import { Button } from './Button';

/**
 * Today, arranged by its owner, and whole features switched off.
 *
 * Hiding never deletes anything: a section or module turned back on returns
 * with everything in it. The board and capture cannot be hidden, because a
 * Today without them stops answering "what do I do now". Order changes with
 * the arrows (one thumb, and a screen reader) or by dragging the handle.
 */

const SECTION_COPY: Record<TodaySection, { label: string; note: string }> = {
  board: { label: 'Widgets', note: 'Your board: clocks, deadlines, goals, the month' },
  capture: { label: 'Capture', note: 'Catch a thought, sort it later' },
  checklist: { label: 'Checklist', note: 'The day’s ticks, as pills' },
};

const MODULE_COPY: Record<Module, { label: string; note: string }> = {
  abood: { label: 'Abood', note: 'The chatbot in the app, on Telegram and on iMessage, and its check-ins' },
  assist: { label: 'Briefing and What now', note: 'The model’s help on Today and Schedule, and breaking work into first moves' },
  grades: { label: 'Grades', note: 'What work is worth, your marks, and where you stand' },
  series: { label: 'Repeating work', note: 'Weekly labs and readings as one series' },
  feeds: { label: 'Calendar feeds', note: 'Subscribed calendars, and your deadlines in other calendars' },
  lowbattery: { label: 'Low-battery mode', note: 'In Today’s ⋯ menu: shrinks the day to the essentials' },
};

export function ArrangeToday({ userId }: { userId: string }) {
  const prefs = usePreferences();
  const [problem, setProblem] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const flip = useRef<Map<HTMLElement, number> | null>(null);

  // Rows that moved slide to their new places (rule 12).
  useLayoutEffect(() => {
    if (!flip.current) return;
    closeUp(flip.current);
    flip.current = null;
  }, [prefs.order]);

  function measure() {
    const rows = Array.from(list.current?.children ?? []) as HTMLElement[];
    flip.current = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
  }

  async function persist(order: TodaySection[], hidden: TodaySection[]) {
    setProblem(null);
    const { error } = await saveTodayLayout(userId, order, hidden);
    if (error) setProblem(error);
  }

  function move(id: TodaySection, by: -1 | 1) {
    const order = [...prefs.order];
    const i = order.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    measure();
    void persist(order, prefs.hidden);
  }

  function toggle(id: TodaySection, show: boolean) {
    const hidden = show ? prefs.hidden.filter((h) => h !== id) : [...prefs.hidden, id];
    void persist(prefs.order, hidden);
  }

  /* Dragging by the handle: the row follows the finger and the others make
     room as it crosses their middles; the order is saved on release. */
  function startDrag(e: React.PointerEvent<HTMLSpanElement>, id: TodaySection) {
    const handle = e.currentTarget;
    const row = handle.closest<HTMLElement>('.arrange-row');
    const container = list.current;
    if (!row || !container) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const top0 = row.getBoundingClientRect().top;
    let offset = 0;
    row.dataset.dragging = '';
    const onMove = (ev: PointerEvent) => {
      const y = top0 + (ev.clientY - startY) + row.offsetHeight / 2;
      const others = (Array.from(container.children) as HTMLElement[]).filter((r) => r !== row);
      const after = others.find((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      if (after !== row.nextElementSibling) {
        const before = new Map(others.map((r) => [r, r.getBoundingClientRect().top]));
        if (after) container.insertBefore(row, after);
        else container.append(row);
        closeUp(before);
      }
      const natural = row.getBoundingClientRect().top - offset;
      offset = top0 + (ev.clientY - startY) - natural;
      row.style.transform = `translateY(${offset}px)`;
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      row.style.transform = '';
      delete row.dataset.dragging;
      const order = (Array.from(container.children) as HTMLElement[]).map((r) => r.dataset.id as TodaySection);
      if (order.join() !== prefs.order.join()) void persist(order, prefs.hidden);
      void id;
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp, { once: true });
    handle.addEventListener('pointercancel', onUp, { once: true });
  }

  async function toggleModule(m: Module, on: boolean, from: HTMLElement) {
    setProblem(null);
    const below = measureBelow(from);
    const next = on ? prefs.modulesOff.filter((x) => x !== m) : [...prefs.modulesOff, m];
    const { error } = await saveModulesOff(userId, next);
    if (error) setProblem(error);
    closeUp(below);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <p className="kicker px-4">Today’s sections</p>
        <div ref={list} className="mat arrange-list" role="list" aria-label="Today’s sections, in order">
          {prefs.order.map((id, i) => {
            const copy = SECTION_COPY[id];
            const locked = ALWAYS_SHOWN.has(id);
            const off = prefs.hidden.includes(id);
            return (
              <div key={id} data-id={id} role="listitem" className="arrange-row" data-off={off || undefined}>
                <span aria-hidden className="arrange-handle" title="Drag to move" onPointerDown={(e) => startDrag(e, id)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.6" />
                    <circle cx="15" cy="6" r="1.6" />
                    <circle cx="9" cy="12" r="1.6" />
                    <circle cx="15" cy="12" r="1.6" />
                    <circle cx="9" cy="18" r="1.6" />
                    <circle cx="15" cy="18" r="1.6" />
                  </svg>
                </span>
                <span className="arrange-label">
                  <b>{copy.label}</b>
                  <span>{copy.note}</span>
                </span>
                <span className="arrange-move">
                  <button type="button" aria-label={`Move ${copy.label} up`} disabled={i === 0} onClick={() => move(id, -1)}>
                    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 15 6-6 6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${copy.label} down`}
                    disabled={i === prefs.order.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </span>
                {locked ? (
                  <span className="arrange-lock">Always</span>
                ) : (
                  <label className="arrange-switch">
                    <input
                      type="checkbox"
                      className="settings-switch"
                      aria-label={`Show ${copy.label} on Today`}
                      checked={!off}
                      onChange={(e) => toggle(id, e.target.checked)}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
        {prefs.order.join() !== TODAY_SECTIONS.join() || prefs.hidden.length > 0 ? (
          <div className="px-4">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                measure();
                void persist([...TODAY_SECTIONS], []);
              }}
            >
              Back to the usual order
            </Button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <p className="kicker px-4">Modules</p>
        <p className="type-note px-4 text-text-low">
          Off takes a feature out of the tab bar, Today and Settings. Nothing in it is deleted, and on brings it all back.
        </p>
        <div className="mat arrange-list">
          {MODULES.map((m) => {
            const copy = MODULE_COPY[m];
            const on = !prefs.modulesOff.includes(m);
            return (
              <label key={m} className="arrange-row" data-off={!on || undefined}>
                <span className="arrange-label" style={{ paddingLeft: '0.5rem' }}>
                  <b>{copy.label}</b>
                  <span>{copy.note}</span>
                </span>
                <input
                  type="checkbox"
                  className="settings-switch"
                  checked={on}
                  onChange={(e) => void toggleModule(m, e.target.checked, e.currentTarget)}
                />
              </label>
            );
          })}
        </div>
      </section>
      {problem && <p className="px-4 type-note text-t-overdue">{problem}</p>}
    </div>
  );
}
