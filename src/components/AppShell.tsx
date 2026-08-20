import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

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
   * The rail has room for "Diet tracker"; a fifth of a phone's width does not,
   * and a wrapped label knocks every tab out of alignment. Falls back to
   * `label` where the full name already fits.
   */
  short?: string;
  /** Drawn rather than imported: eight glyphs is not worth an icon dependency. */
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
    <div className="lg:flex lg:min-h-svh">
      <Rail current={current} items={items} onNavigate={onNavigate} />

      {/* min-w-0 so a wide child (a long title, a table) shrinks instead of
          pushing the rail off screen. */}
      <div className="min-w-0 flex-1">{children}</div>

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

  const shown = items.slice(0, PRIMARY);
  const rest = items.slice(PRIMARY);
  const inRest = rest.some((i) => i.id === current);

  return (
    <>
      {more && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/70 lg:hidden"
          onClick={() => setMore(false)}
          aria-hidden
        />
      )}

      {more && (
        <div className="fixed inset-x-0 bottom-[calc(var(--tab-bar)+env(safe-area-inset-bottom))] z-50 mx-3 overflow-hidden rounded-card border border-ink-600 bg-ink-700 lg:hidden">
          {rest.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                setMore(false);
              }}
              className={[
                'flex min-h-[var(--tap)] w-full items-center gap-3 border-b border-ink-600 px-4 text-left last:border-b-0',
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
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(var(--tab-bar)+env(safe-area-inset-bottom))] items-start border-t border-ink-600 bg-ink-800 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {shown.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMore(false);
                onNavigate(item.id);
              }}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex h-[var(--tab-bar)] flex-1 flex-col items-center justify-center gap-1',
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
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className={[
            'flex h-[var(--tab-bar)] flex-1 flex-col items-center justify-center gap-1',
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
  const reduced = useReducedMotion();

  return (
    <nav
      aria-label="Main"
      // Sticky rather than fixed: it scrolls with a short page and pins on a
      // long one, without the content needing a matching margin that would
      // drift out of sync the moment the rail's width changed.
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-ink-600 bg-ink-800 px-3 py-6 lg:flex"
    >
      <div className="mb-6 px-3">
        <span className="type-h2 text-text-hi">Planner</span>
      </div>

      {items.map((item) => {
        const active = item.id === current;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative flex min-h-[var(--tap)] items-center gap-3 rounded-card px-3 text-left',
              active ? 'text-text-hi' : 'text-text-mid hover:text-text-hi',
            ].join(' ')}
          >
            {/*
              One element slides between items rather than each item fading its
              own background in and out. That is what makes the rail feel like
              a single control instead of eight independent buttons, and it is
              the one thing a layout animation does that CSS cannot.
            */}
            {active && (
              <motion.span
                layoutId="rail-active"
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 420, damping: 34 }
                }
                className="absolute inset-0 -z-10 rounded-card bg-ink-700"
              />
            )}
            <span aria-hidden className="shrink-0 text-text-mid">
              {item.icon}
            </span>
            <span className="type-label">{item.label}</span>
          </button>
        );
      })}
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
