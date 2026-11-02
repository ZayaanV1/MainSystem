import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { NavItem } from './AppShell';
import { popIcon } from '../lib/motion';
import { VISION_EASE } from '../lib/vision';
import { useAuth } from '../lib/auth';
import type { TodayData } from '../lib/planner';
import { VisionIsland } from './VisionIsland';
import { useNow } from '../lib/useNow';

/**
 * Vision's desk chrome: a glass sidebar on the left and a bar along the top,
 * in place of the rail (lib/vision.ts).
 *
 * The sidebar holds every destination, exactly as the rail did. The top bar
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
      <Sidebar current={current} items={items} onNavigate={onNavigate} full={full} />
    </>
  );
}

const SIDE_KEY = 'planner.visionSide';

function readOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) === 'open';
  } catch {
    return false;
  }
}

const motionLevel = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'none'
    : (document.documentElement.dataset.motion ?? 'full');

/** Dock magnification on the rail: 1.4 under the cursor, 1.18 a row away, 1 two rows away. */
function magnification(distance: number): number {
  if (distance >= 80) return 1;
  if (distance <= 40) return 1.4 - (distance / 40) * 0.22;
  return 1.18 - ((distance - 40) / 40) * 0.18;
}

/**
 * The glass sidebar, from code.xr's "Glassy Sidebar V5" (1 Nov 2026).
 *
 * Closed it is a slim rail: icons magnify like a dock under a real pointer and
 * name themselves in a light bubble. Open (the toggle on its edge, or `[`) it
 * is a labelled panel. Hover is a soft fill; the current place wears a glass
 * lens that, when the place changes, stretches across to the next row edge
 * first and lets the far edge catch up. The search field is the app's own
 * Search destination, in the place the reel gives it; the top bar's pill is
 * still the command palette. Open or closed is remembered per device.
 */
function Sidebar<T extends string>({
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
  const [open, setOpen] = useState(readOpen);
  const [height, setHeight] = useState<number | null>(null);
  const side = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  const placed = useRef<string | null>(null);
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const initial = (email || '?').slice(0, 1).toUpperCase();
  // Search takes the field at the top and Settings the account at the foot;
  // every other destination is a row.
  const main = items.filter((i) => i.id !== 'settings' && i.id !== 'search');
  const search = items.find((i) => i.id === 'search');
  const settings = items.find((i) => i.id === 'settings');

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed');
    } catch {
      // Private windows can refuse storage; the sidebar still works, it just forgets.
    }
  }, [open]);

  // `[` opens and closes it, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Floating, the glass hugs what it holds, so its height follows the content
  // and can ease between the rail and the panel.
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The lens. Animated by its top and height rather than a scale, so its
  // round ends and its rim stay true while it travels.
  useLayoutEffect(() => {
    const l = lit.current;
    const target = list.current?.querySelector<HTMLElement>(`[data-slot="${current}"]`) ?? null;
    if (!l) return;
    l.getAnimations().forEach((a) => a.cancel());
    if (!open || !target) {
      l.style.opacity = '0';
      placed.current = null;
      return;
    }
    const to = target.offsetTop;
    const h = target.offsetHeight;
    const from = parseFloat(l.style.top);
    const moving = placed.current !== null && placed.current !== current && !Number.isNaN(from) && from !== to;
    l.style.top = `${to}px`;
    l.style.height = `${h}px`;
    l.style.opacity = '1';
    placed.current = current;
    const level = motionLevel();
    if (!moving || level === 'none') return;
    const start = { top: `${from}px`, height: `${h}px` };
    const end = { top: `${to}px`, height: `${h}px` };
    // Full motion stretches over both rows on the way; calm just glides.
    const keyframes =
      level === 'full'
        ? [
            start,
            to > from ? { top: `${from}px`, height: `${to + h - from}px`, offset: 0.42 } : { top: `${to}px`, height: `${from + h - to}px`, offset: 0.42 },
            end,
          ]
        : [start, end];
    l.animate(keyframes, { duration: 440, easing: VISION_EASE });
  }, [current, open, main.length]);

  const magnify = (e: PointerEvent<HTMLElement>) => {
    if (open || e.pointerType !== 'mouse' || motionLevel() !== 'full') return;
    side.current?.querySelectorAll<HTMLElement>('[data-mag]').forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mag', magnification(Math.abs(e.clientY - (r.top + r.height / 2))).toFixed(3));
    });
  };
  const rest = () => side.current?.querySelectorAll<HTMLElement>('[data-mag]').forEach((el) => el.style.removeProperty('--mag'));
  useEffect(() => {
    if (open) rest();
  }, [open]);

  return (
    <nav
      ref={side}
      aria-label="Main"
      className="vt-chrome v-sb"
      data-open={open || undefined}
      data-full={full || undefined}
      style={!full && height ? { height } : undefined}
      onPointerMove={magnify}
      onPointerLeave={rest}
    >
      <div ref={inner} className="v-sb-in">
        <div className="v-sb-head">
          <img src="/favicon.svg" alt="" className="v-sb-mark" />
          <span className="v-in v-sb-name">
            <span>Planner</span>
            <span className="v-sb-sub">Student planner</span>
          </span>
        </div>

        {search && (
          <button
            type="button"
            data-mag
            aria-label={search.label}
            aria-current={current === search.id ? 'page' : undefined}
            onClick={() => onNavigate(search.id)}
            className={`v-sb-search ${current === search.id ? 'is-active' : ''}`}
          >
            <span aria-hidden className="v-sb-ico">
              {search.icon}
            </span>
            <span aria-hidden className="v-in v-sb-grow">
              Search pages
            </span>
            <span aria-hidden className="v-tip">
              {search.label}
            </span>
          </button>
        )}

        <span aria-hidden className="v-sb-rule" />
        <p aria-hidden className="v-in v-sb-label">
          Menu
        </p>

        <div ref={list} className="v-sb-list">
          <span ref={lit} aria-hidden className="v-sb-lit" style={{ opacity: 0 }} />
          {main.map((item, j) => {
            const active = item.id === current;
            return (
              <button
                key={item.id}
                data-slot={item.id}
                data-mag
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={item.badge ? `${item.label}, ${item.badge} in the inbox` : item.label}
                onClick={(e) => {
                  if (!active) popIcon(e.currentTarget.querySelector('svg'));
                  onNavigate(item.id);
                }}
                className={`v-sb-btn ${active ? 'is-active' : ''}`}
                style={{ '--j': j } as CSSProperties}
              >
                <span aria-hidden className="v-sb-ico">
                  {item.icon}
                  {item.badge ? <span className="v-sb-dot" /> : null}
                </span>
                <span aria-hidden className="v-in v-sb-grow">
                  {item.label}
                </span>
                {item.badge ? (
                  <span aria-hidden className="v-in tab-badge v-sb-count">
                    {item.badge}
                  </span>
                ) : null}
                <span aria-hidden className="v-tip">
                  {item.label}
                  {item.badge ? <kbd>{item.badge}</kbd> : null}
                </span>
              </button>
            );
          })}
        </div>

        <span aria-hidden className="v-sb-rule v-sb-rule-foot" />
        {settings && (
          <button
            type="button"
            data-mag
            aria-label={settings.label}
            aria-current={current === settings.id ? 'page' : undefined}
            onClick={() => onNavigate(settings.id)}
            className={`v-sb-btn v-sb-me ${current === settings.id ? 'is-active' : ''}`}
            style={{ '--j': main.length } as CSSProperties}
          >
            <span aria-hidden className="v-sb-avatar">
              {initial}
            </span>
            <span aria-hidden className="v-in v-sb-grow v-sb-who">
              <span>{settings.label}</span>
              <span className="v-sb-sub">{email}</span>
            </span>
            <svg aria-hidden className="v-in v-sb-updown" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 15 5 5 5-5" />
              <path d="m7 9 5-5 5 5" />
            </svg>
            <span aria-hidden className="v-tip">
              {settings.label}
            </span>
          </button>
        )}
      </div>

      {/* The toggle straddles the glass's right edge, level with the mark, open or closed. */}
      <button
        type="button"
        className="v-sb-toggle"
        aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={open}
        aria-keyshortcuts="["
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        <span aria-hidden className="v-tip">
          {open ? 'Collapse' : 'Expand'} <kbd>[</kbd>
        </span>
      </button>
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
