import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { describeHealth, fetchHealth, type NotificationHealth } from '../lib/health';
import { formatDay, todayKey, zoneAbbrev } from '../lib/time';

/**
 * Today — the default view.
 *
 * Opening the app answers "what do I do right now" without navigation. In
 * Phase 0 the honest answer is that nothing is scheduled, because assignments
 * and the checklist arrive in Phase 1 after the push proof. So this is the
 * empty state, and the empty state is the point: it is neutral, it states a
 * fact, and it does not congratulate anyone for having an empty day.
 *
 * The one extra thing on this screen is the notification health line. It is
 * here rather than buried in settings because "nothing important is hidden
 * behind a tap" — and a dead notification pipeline is the most important
 * thing this app could fail to tell you.
 */
export function Today({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [health, setHealth] = useState<NotificationHealth | null>(null);

  useEffect(() => {
    void fetchHealth().then(setHealth);
  }, []);

  const today = todayKey();
  const status = health ? describeHealth(health) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <div>
          <h1 className="type-h1 text-text-hi">Today</h1>
          <p className="type-caption mt-1 text-text-low">
            {formatDay(today)} &middot; {zoneAbbrev()}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="type-label text-text-mid"
        >
          Settings
        </button>
      </header>

      <div className="flex-1">
        <EmptyState>Nothing due.</EmptyState>
      </div>

      {status && (
        <footer className="border-t border-ink-600 px-4 py-4">
          <p className={`type-caption ${status.warn ? 'text-t-critical' : 'text-text-low'}`}>
            {status.text}
          </p>
        </footer>
      )}
    </main>
  );
}
