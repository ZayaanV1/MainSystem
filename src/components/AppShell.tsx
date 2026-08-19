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
    <div className="lg:flex lg:min-h-dvh">
      <Rail current={current} items={items} onNavigate={onNavigate} />

      {/* min-w-0 so a wide child (a long title, a table) shrinks instead of
          pushing the rail off screen. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
      aria-label="Sections"
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
 * Deliberately small: a short fade with a few pixels of travel. A screen
 * change happens dozens of times a session, and anything with personality at
 * that frequency becomes a tax on getting anywhere.
 *
 * The exit is faster than the entrance. Waiting for something to leave is
 * dead time; waiting for something to arrive is the thing you asked for.
 */
export function Page({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();

  // The caller supplies `key`, which React consumes before it reaches props —
  // AnimatePresence reads it off the element, so there is nothing to thread
  // through here and an `id` prop would only be a second thing to keep in step.
  if (reduced) return <div>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
    >
      {children}
    </motion.div>
  );
}
