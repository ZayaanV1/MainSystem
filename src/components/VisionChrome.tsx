import { useLayoutEffect, useRef } from 'react';
import type { NavItem } from './AppShell';
import { followCapsule, moveCapsule, popIcon } from '../lib/motion';
import { useAuth } from '../lib/auth';
import type { TodayData } from '../lib/planner';
import { VisionIsland } from './VisionIsland';
import { useNow } from '../lib/useNow';

/**
 * Vision's desk chrome: a floating dock on the left and a bar along the top,
 * in place of the rail (lib/vision.ts).
 *
 * The dock holds every destination, exactly as the rail did. The top bar
 * deliberately does not repeat them: it holds what the dock cannot, which is
 * the time, the search pill that also opens into the day (VisionIsland, where
 * a thought is caught too), and three shortcuts with something to say (the
 * inbox's count, Abood, the account).
 */
export function VisionChrome<T extends string>({
  current,
  items,
  onNavigate,
  onPalette,
  full,
  day,
}: {
  current: T;
  items: NavItem<T>[];
  onNavigate: (id: T) => void;
  onPalette?: () => void;
  /** The full-height sidebar (Appearance > Vision) rather than the floating dock. */
  full: boolean;
  /** The loaded day, for the island. */
  day: TodayData | null;
}) {
  return (
    <>
      <TopBar items={items} onNavigate={onNavigate} onPalette={onPalette} day={day} />
      <Dock current={current} items={items} onNavigate={onNavigate} full={full} />
    </>
  );
}

function Dock<T extends string>({
  current,
  items,
  onNavigate,
  full,
}: {
  current: T;
  items: NavItem<T>[];
  onNavigate: (id: T) => void;
  full: boolean;
}) {
  const lit = useRef<HTMLSpanElement>(null);
  const dock = useRef<HTMLElement>(null);
  const index = items.findIndex((i) => i.id === current);

  // One white disc travels between items, as the rail's capsule does.
  useLayoutEffect(() => {
    const slots = dock.current?.querySelectorAll<HTMLElement>('[data-slot]');
    if (lit.current) moveCapsule(lit.current, slots?.[index] ?? null, 'y');
    if (!dock.current) return;
    return followCapsule(dock.current, () => {
      const now = dock.current?.querySelectorAll<HTMLElement>('[data-slot]');
      if (lit.current) moveCapsule(lit.current, now?.[index] ?? null, 'y', { instant: true });
    });
  }, [index, full]);

  return (
    <nav ref={dock} aria-label="Main" className="vt-chrome v-dock">
      <span ref={lit} aria-hidden className="v-dock-lit" style={{ opacity: 0 }} />
      {full && <img src="/favicon.svg" alt="" className="v-dock-mark" />}
      {items.map((item) => {
        const active = item.id === current;
        return (
          <button
            key={item.id}
            data-slot
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={item.badge ? `${item.label}, ${item.badge} in the inbox` : item.label}
            onClick={(e) => {
              if (!active) popIcon(e.currentTarget.querySelector('svg'));
              onNavigate(item.id);
            }}
            // In the full-height sidebar, Settings sits at the foot, as in V7.
            className={`v-dock-btn ${active ? 'is-active' : ''} ${full && item.id === 'settings' ? 'v-dock-foot' : ''}`}
          >
            <span aria-hidden className="relative">
              {item.icon}
              {item.badge ? <span className="tab-badge">{item.badge}</span> : null}
            </span>
            <span aria-hidden className="v-tip">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function TopBar<T extends string>({
  items,
  onNavigate,
  onPalette,
  day,
}: {
  items: NavItem<T>[];
  onNavigate: (id: T) => void;
  onPalette?: () => void;
  day: TodayData | null;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const initial = (session?.user.email ?? '?').slice(0, 1).toUpperCase();
  const now = useNow();

  const has = (id: string) => items.find((i) => i.id === id);
  const inbox = has('week')?.badge ?? 0;
  const go = (id: string) => {
    const item = has(id);
    if (item) onNavigate(item.id);
  };

  return (
    <header className="vt-chrome v-top">
      <p className="v-pill v-clock">
        <time dateTime={now.toISOString()}>
          {new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}
          <span className="text-text-low"> · </span>
          {new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(now)}
        </time>
      </p>

      <VisionIsland userId={userId} day={day} onGo={(id) => go(id)} onPalette={onPalette} />

      <div className="v-top-end">
        {has('week') && (
          <button type="button" className="v-round" aria-label={inbox ? `Inbox, ${inbox} to sort` : 'Inbox'} onClick={() => go('week')}>
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
            </svg>
            {inbox ? <span className="tab-badge">{inbox}</span> : null}
          </button>
        )}
        {has('ask') && (
          <button type="button" className="v-round" aria-label="Abood" onClick={() => go('ask')}>
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
            </svg>
          </button>
        )}
        {has('settings') && (
          <button type="button" className="v-avatar" aria-label="Account and settings" onClick={() => go('settings')}>
            {initial}
          </button>
        )}
      </div>
    </header>
  );
}
