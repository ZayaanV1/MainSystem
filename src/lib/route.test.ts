import { describe, it, expect } from 'vitest';
import { formatRoute, parseRoute, type Route } from './route';

const id = '3f2a9c1e-7b44-4d2e-9a10-5c6d7e8f9a0b';

describe('routes', () => {
  it('reads every screen, and anything unknown as Today', () => {
    expect(parseRoute('/', '').screen).toBe('today');
    expect(parseRoute('/week', '').screen).toBe('week');
    expect(parseRoute('/ask/', '').screen).toBe('ask');
    expect(parseRoute('/nonsense', '').screen).toBe('today');
  });

  it('reads Month’s day, a Settings page and an open item', () => {
    expect(parseRoute('/month', '?day=2026-10-07')).toEqual({ screen: 'month', day: '2026-10-07' });
    expect(parseRoute('/settings/abood', '')).toEqual({ screen: 'settings', page: 'abood' });
    expect(parseRoute('/week', `?work=${id}`)).toEqual({ screen: 'week', open: { kind: 'work', id } });
    expect(parseRoute('/', `?inbox=${id}`)).toEqual({ screen: 'today', open: { kind: 'inbox', id } });
  });

  it('ignores malformed values rather than passing them on', () => {
    expect(parseRoute('/month', '?day=tomorrow')).toEqual({ screen: 'month' });
    expect(parseRoute('/', '?work=<script>')).toEqual({ screen: 'today' });
    expect(parseRoute('/settings/../../etc', '')).toEqual({ screen: 'settings' });
  });

  it('writes back what it reads', () => {
    const routes: Route[] = [
      { screen: 'today' },
      { screen: 'month', day: '2026-10-07' },
      { screen: 'settings', page: 'notifications' },
      { screen: 'search', open: { kind: 'work', id } },
      { screen: 'today', open: { kind: 'inbox', id } },
    ];
    for (const r of routes) {
      const url = new URL(formatRoute(r), 'https://example.test');
      expect(parseRoute(url.pathname, url.search)).toEqual(r);
    }
    expect(formatRoute({ screen: 'today' })).toBe('/');
  });
});
