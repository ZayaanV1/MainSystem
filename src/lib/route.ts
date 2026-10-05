import type { DayKey } from './time';

/**
 * Where the app is, as a URL.
 *
 * Every screen and every open item has an address, so the back gesture works
 * everywhere, a notification can open the thing it is about, and a
 * list-to-detail transition has two real ends. Hand-rolled: seven screens and
 * two kinds of open item do not need a router dependency, and this is the
 * whole of the mapping.
 *
 *   /                      Today
 *   /week  /month  /search  /ask  /plan
 *   /month?day=2026-10-07  Month, open on a day
 *   /settings/abood        a Settings page
 *   ?work=<id>             a piece of work open in the editor, on any screen
 *   ?inbox=<id>            a captured thought open to sort, on any screen
 */

export type Screen = 'today' | 'week' | 'month' | 'plan' | 'ask' | 'search' | 'settings';

export interface Route {
  screen: Screen;
  /** Month's chosen day. */
  day?: DayKey;
  /** A Settings page. */
  page?: string;
  /** Something open over the screen. */
  open?: { kind: 'work' | 'inbox'; id: string };
}

const SCREENS: Screen[] = ['today', 'week', 'month', 'plan', 'ask', 'search', 'settings'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f-]{8,64}$/i;
const PAGE = /^[a-z-]{2,24}$/;

/** Read a location. Anything unknown is Today: a bad link opens the app, never an error. */
export function parseRoute(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  const first = parts[0] as Screen | undefined;
  const screen: Screen = first && SCREENS.includes(first) ? first : 'today';
  const q = new URLSearchParams(search);
  const route: Route = { screen };

  const day = q.get('day');
  if (screen === 'month' && day && DAY.test(day)) route.day = day as DayKey;
  if (screen === 'settings' && parts[1] && PAGE.test(parts[1])) route.page = parts[1];

  const work = q.get('work');
  const inbox = q.get('inbox');
  if (work && ID.test(work)) route.open = { kind: 'work', id: work };
  else if (inbox && ID.test(inbox)) route.open = { kind: 'inbox', id: inbox };
  return route;
}

/** Write a route back as a path and query. Inverse of parseRoute for every valid route. */
export function formatRoute(route: Route): string {
  let path = route.screen === 'today' ? '/' : `/${route.screen}`;
  if (route.screen === 'settings' && route.page) path += `/${route.page}`;
  const q = new URLSearchParams();
  if (route.screen === 'month' && route.day) q.set('day', route.day);
  if (route.open) q.set(route.open.kind, route.open.id);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.search);
}
