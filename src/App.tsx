import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { startOutbox, subscribeOutbox, type OutboxState } from './lib/outbox';
import { refreshSubscription } from './lib/notifications';
import { SignIn } from './routes/SignIn';
import { Today } from './routes/Today';
import { Settings } from './routes/Settings';
import { Specimen } from './routes/Specimen';

/**
 * Two screens, so routing is a piece of state rather than a dependency. Phase 1
 * introduces Week and Month and will want a real router; adding one now would
 * be furniture for a room that does not exist.
 */
type Screen = 'today' | 'settings';

/** Shown before setup has been run, instead of a white screen and a console error. */
function NotConfigured() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-100 flex-col justify-center px-6">
      <h1 className="type-h1 mb-2 text-text-hi">Not set up yet</h1>
      <p className="type-body text-text-mid">
        No Supabase connection is configured. Copy .env.setup.example to .env.setup, fill it in,
        and run npm run setup.
      </p>
    </main>
  );
}

/**
 * The sync banner.
 *
 * Rule 5: never silently lose data. Queued writes are invisible by design —
 * that is the point of optimistic UI — so the one moment they must become
 * visible is when they stop going through.
 */
function SyncBanner() {
  const [state, setState] = useState<OutboxState>({ pending: 0, error: null, syncing: false });

  useEffect(() => subscribeOutbox(setState), []);

  if (!state.error) return null;

  return (
    <div
      role="status"
      className="border-b border-ink-600 bg-ink-700 px-4 py-3"
    >
      <p className="type-caption text-t-critical">
        {state.error} {state.pending} change{state.pending === 1 ? '' : 's'} waiting.
      </p>
    </div>
  );
}

function Shell() {
  const { session, loading } = useAuth();
  const [screen, setScreen] = useState<Screen>('today');

  useEffect(() => {
    if (!session) return;

    startOutbox();

    // iOS invalidates push subscriptions while the app is closed and says
    // nothing. Re-subscribing on every launch is the only defence.
    void refreshSubscription();
  }, [session]);

  // Nothing is rendered until the stored session has been read back, so the
  // sign-in screen does not flash on every launch.
  if (loading) return null;

  if (!session) return <SignIn />;

  return (
    <>
      <SyncBanner />
      {screen === 'today' ? (
        <Today onOpenSettings={() => setScreen('settings')} />
      ) : (
        <Settings onBack={() => setScreen('today')} />
      )}
    </>
  );
}

export default function App() {
  // The design system specimen, in development only. Never reachable in a
  // production build, and tree-shaken out of it entirely.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('specimen')) {
    return <Specimen />;
  }

  if (!isConfigured) return <NotConfigured />;

  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
