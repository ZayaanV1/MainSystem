import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { EASE } from '../lib/motion';

/**
 * The command palette: cmd/ctrl+K, on a laptop.
 *
 * One box that reaches every screen, every Settings page, every piece of open
 * work and every course, plus the handful of actions worth a keystroke. It
 * adds no capability of its own: each entry runs the same function a tap
 * would, so nothing done from here differs from doing it by hand.
 *
 * Ranked the way Search is: a label that starts with what was typed beats one
 * that merely contains it, and an empty query shows the actions and screens
 * rather than everything at once.
 */

export interface Command {
  id: string;
  group: 'Do' | 'Go to' | 'Work' | 'Courses' | 'Settings';
  label: string;
  /** Shown on the right: a due date, a course code, a shortcut. */
  hint?: string;
  /** Extra words that should find it ("dark" finds Light or dark). */
  keywords?: string;
  run: () => void;
}

const GROUP_ORDER: Command['group'][] = ['Do', 'Go to', 'Work', 'Courses', 'Settings'];

export function rank(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands.filter((c) => c.group === 'Do' || c.group === 'Go to');
  const scored: { c: Command; score: number }[] = [];
  for (const c of commands) {
    const label = c.label.toLowerCase();
    const words = `${label} ${c.keywords ?? ''} ${c.hint ?? ''}`.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 3;
    else if (label.split(/[\s:·,-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (words.includes(q)) score = 1;
    if (score >= 0) scored.push({ c, score });
  }
  // Grouped, so each heading appears once: the group holding the best match
  // comes first, and within a group the better matches lead.
  const best = new Map<Command['group'], number>();
  for (const { c, score } of scored) best.set(c.group, Math.max(best.get(c.group) ?? -1, score));
  return scored
    .sort(
      (a, b) =>
        (best.get(b.c.group) ?? 0) - (best.get(a.c.group) ?? 0) ||
        GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group) ||
        b.score - a.score,
    )
    .map((s) => s.c)
    .slice(0, 40);
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(document.activeElement);

  const results = useMemo(() => rank(commands, query), [commands, query]);
  useEffect(() => setActive(0), [query]);

  useLayoutEffect(() => {
    input.current?.focus();
    const el = panel.current;
    if (el && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.animate([{ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE.glide });
    }
    const back = restore.current;
    return () => {
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);

  // The highlighted row stays in view as the arrows move it.
  useEffect(() => {
    panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(c: Command | undefined) {
    if (!c) return;
    onClose();
    // After the palette has gone, so a command that focuses something (the
    // capture box) is not undone by focus returning to where it was.
    window.setTimeout(() => c.run(), 0);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // The palette is one field and a list; Tab stays inside it.
      e.preventDefault();
    }
  }

  let lastGroup: string | null = null;
  return createPortal(
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="palette mat mat-raised" role="dialog" aria-modal="true" aria-label="Commands">
        <div className="palette-field">
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Go to, do, or find"
            aria-label="Go to, do, or find"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="palette-kbd">esc</kbd>
        </div>
        <div id="palette-list" className="palette-list" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <p className="palette-empty">Nothing matches “{query.trim()}”.</p>
          ) : (
            results.map((c, i) => {
              const head = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {head && <p className="palette-group">{head}</p>}
                  <div
                    id={`palette-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    className="palette-item"
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="palette-hint">{c.hint}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
