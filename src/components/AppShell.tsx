import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { moveCapsule, popClose, popIcon, popOpen } from '../lib/motion';

/**
 * The frame the whole app sits in.
 *
 * Until now every route hardcoded a 640px column, which is right on a phone
 * and wrong on a laptop — a narrow strip marooned in the middle of a 1440px
 * window, with the navigation hidden in a row of small text at the top.
 *
 * So the shell provides the chrome and the routes provide the content. Below
 * `lg` nothing changes: routes keep their own header and the shell renders
 * nothing around them. At `lg` and up a persistent rail appears, the content
 * gets real width, and navigation stops being a thing you hunt for.
 *
 * One frame, two layouts, one set of routes. The alternative — a separate
 * desktop build — is two apps to keep in step, and they never stay in step.
 */

export interface NavItem<T extends string> {
  id: T;
  label: string;
  /**
   * A shorter form for the phone tab bar.
   *
   * The rail has room for a long label; a fifth of a phone's width does not,
   * and a wrapped label knocks every tab out of alignment. Falls back to
   * `label` where the full name already fits.
   */
  short?: string;
  /** Drawn rather than imported: seven glyphs is not worth an icon dependency. */
  icon: ReactNode;
}

export function AppShell<T extends string>({
  current,
  items,
  onNavigate,
  children,
}: {
  current: T;
  items: NavItem<T>[];
  onNavigate: (id: T) => void;
  children: ReactNode;
}) {
  return (
    <div className="atmosphere lg:flex lg:min-h-svh">
      <Rail current={current} items={items} onNavigate={onNavigate} />

      {/* min-w-0 so a wide child (a long title, a table) shrinks instead of
          pushing the rail off screen. */}
      {/* data-recede: this column sinks back behind an open sheet (Phase B). */}
      <div data-recede className="min-w-0 flex-1">{children}</div>

      <TabBar current={current} items={items} onNavigate={onNavigate} />
    </div>
  );
}

/**
 * The phone's navigation, pinned to the bottom.
 *
 * It was a row of links in the header, which worked while they were bare text
 * and broke the moment they became real buttons: eight of them wrapped onto
 * three lines and pushed the actual content 280px down the screen. Rule 1 says
 * opening the app answers "what do I do right now" in under two seconds, and
 * that is hard to do from below the fold.
 *
 * Five slots, because that is what fits a thumb's reach across a phone without
 * shrinking targets below the tap floor. The rest live behind More rather than
 * being squeezed in — a sixth cramped item helps nobody.
 */
const PRIMARY = 4;

function TabBar<T extends string>({
  current,
  items,
  onNavigate,
}: {
  current: T;
  items: NavItem<T>[];
  onNavigate: (id: T) => void;
}) {
  const [more, setMore] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLElement>(null);

  const shown = items.slice(0, PRIMARY);
  const rest = items.slice(PRIMARY);
  const inRest = rest.some((i) => i.id === current);
  const litIndex = Math.max(-1, shown.findIndex((i) => i.id === current));
  const litSlot = litIndex >= 0 ? litIndex : inRest || more ? PRIMARY : -1;

  /*
   * One lit capsule for the whole bar, moved to the tab you chose. It used to
   * be a Motion layoutId per tab, which ran its spring from JavaScript; this
   * plays in the browser and stretches as it travels (rule 12).
   */
  useLayoutEffect(() => {
    const slots = bar.current?.querySelectorAll<HTMLElement>('[data-slot]');
    if (lit.current) moveCapsule(lit.current, slots?.[litSlot] ?? null, 'x');
  }, [litSlot]);

  // The More menu opens from its button and closes back into it, instead of
  // appearing and vanishing.
  useLayoutEffect(() => {
    if (more) {
      popOpen(menu.current, '100% 100%');
      scrim.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    }
  }, [more]);
  const closing = useRef(false);
  async function closeMore() {
    if (closing.current) return;
    closing.current = true;
    scrim.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: 'ease-out', fill: 'forwards' });
    await popClose(menu.current);
    closing.current = false;
    setMore(false);
  }

  return (
    <>
      {more && (
        <div
          ref={scrim}
          className="sheet-scrim fixed inset-0 z-40 lg:hidden"
          onClick={() => void closeMore()}
          aria-hidden
        />
      )}

      {more && (
        <div
          ref={menu}
          className="fx-glass tab-menu fixed inset-x-3 bottom-[calc(var(--tab-bar)+env(safe-area-inset-bottom)+var(--sp-6))] z-50 overflow-hidden rounded-sheet border border-ink-600 lg:hidden"
        >
          {rest.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                void closeMore();
              }}
              className={[
                'press-row flex min-h-[var(--tap)] w-full items-center gap-3 border-b border-ink-600 px-4 text-left last:border-b-0',
                item.id === current ? 'text-text-hi' : 'text-text-mid',
              ].join(' ')}
            >
              <span aria-hidden className="shrink-0 text-text-low">{item.icon}</span>
              <span className="type-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      <nav
        ref={bar}
        aria-label="Main"
        // Glass, floating clear of the bottom edge so content passes under it
        // on both sides; the one surface that earns a backdrop read.
        className="vt-chrome fx-glass tab-bar fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+var(--sp-3))] z-50 flex h-[var(--tab-bar)] items-stretch overflow-hidden rounded-pill border border-ink-600 p-1.5 lg:hidden"
      >
        <span ref={lit} aria-hidden className="nav-lit pointer-events-none absolute top-1.5 bottom-1.5 left-0 rounded-pill" style={{ opacity: 0 }} />
        {shown.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              data-slot
              type="button"
              onClick={(e) => {
                if (more) void closeMore();
                if (!active) popIcon(e.currentTarget.querySelector('svg'));
                onNavigate(item.id);
              }}
              aria-current={active ? 'page' : undefined}
              className={[
                'tab-btn relative z-10 flex flex-1 flex-col items-center justify-center gap-1 rounded-pill',
                active ? 'text-text-hi' : 'text-text-low',
              ].join(' ')}
            >
              <span aria-hidden>{item.icon}</span>
              <span className="type-caption">{item.short ?? item.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          data-slot
          onClick={(e) => {
            if (more) {
              void closeMore();
              return;
            }
            popIcon(e.currentTarget.querySelector('svg'));
            setMore(true);
          }}
          aria-expanded={more}
          className={[
            'tab-btn relative z-10 flex flex-1 flex-col items-center justify-center gap-1 rounded-pill',
            more || inRest ? 'text-text-hi' : 'text-text-low',
          ].join(' ')}
        >
          <span aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M5 12h.01M12 12h.01M19 12h.01" />
            </svg>
          </span>
          <span className="type-caption">More</span>
        </button>
      </nav>
    </>
  );
}

function Rail<T extends string>({
  current,
  items,
  onNavigate,
}: {
  current: T;
  items: NavItem<T>[];
  onNavigate: (id: T) => void;
}) {
  const lit = useRef<HTMLSpanElement>(null);
  const rail = useRef<HTMLElement>(null);
  const index = items.findIndex((i) => i.id === current);

  // One capsule slides between items, so the rail reads as a single control
  // rather than eight buttons each lighting its own background.
  useLayoutEffect(() => {
    const slots = rail.current?.querySelectorAll<HTMLElement>('[data-slot]');
    if (lit.current) moveCapsule(lit.current, slots?.[index] ?? null, 'y');
  }, [index]);

  return (
    <nav
      ref={rail}
      aria-label="Main"
      // Sticky rather than fixed: it scrolls with a short page and pins on a
      // long one, without the content needing a matching margin.
      className="vt-chrome sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-ink-600 bg-ink-800 px-3 py-6 lg:flex"
    >
      <div className="mb-6 px-3">
        <span className="type-h2 text-text-hi">Planner</span>
      </div>

      <div className="relative flex flex-col gap-1">
        <span ref={lit} aria-hidden className="nav-lit pointer-events-none absolute inset-x-0 top-0 rounded-card" style={{ opacity: 0 }} />
        {items.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              data-slot
              type="button"
              onClick={(e) => {
                if (!active) popIcon(e.currentTarget.querySelector('svg'));
                onNavigate(item.id);
              }}
              aria-current={active ? 'page' : undefined}
              className={[
                'relative z-10 flex min-h-[var(--tap)] items-center gap-3 rounded-card px-3 text-left',
                active ? 'text-text-hi' : 'text-text-mid hover:text-text-hi',
              ].join(' ')}
            >
              <span aria-hidden className="shrink-0 text-text-mid">
                {item.icon}
              </span>
              <span className="type-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Wraps a screen so swapping screens is a transition rather than a cut.
 *
 * A plain element with a CSS animation, deliberately not a Motion component.
 * The transition fires at the exact moment a full screen is mounting and its
 * data fetch is starting, and a JS-driven animation competes with both for the
 * main thread — so it dropped frames precisely at the start, which is the part
 * you notice. CSS hands it to the compositor instead.
 *
 * The caller's `key` is what makes it re-run: a new key means a new DOM node,
 * and a fresh node runs its animation from the beginning.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
