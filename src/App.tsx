import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { startOutbox, subscribeOutbox, type OutboxState } from './lib/outbox';
import { refreshSubscription } from './lib/notifications';
import type { Assignment, TodayData } from './lib/planner';
import { SignIn } from './routes/SignIn';
import { Today } from './routes/Today';
import { Plan } from './routes/Plan';
import { Week } from './routes/Week';
import { Month } from './routes/Month';
import { Chat } from './routes/Chat';
import { Diet } from './routes/Diet';
import { AssignmentEditor } from './routes/AssignmentEditor';
import { Settings } from './routes/Settings';
import { Specimen } from './routes/Specimen';

/**
 * Routing is a piece of state rather than a dependency.
 *
 * Five screens with no nesting, no URL to preserve and one user. A router
 * would add a dependency, a bundle, and a set of concepts to hold, in exchange
 * for nothing this app currently needs. Revisit when a screen needs to be
 * linkable from outside — a notification deep link into a specific assignment
 * would be the moment.
 */
type Screen = 'today' | 'week' | 'month' | 'plan' | 'food' | 'ask' | 'settings';

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

  // Two conditions, not one. An error is obvious, but the worse case is work
  // sitting in the queue with nothing wrong reported — which is exactly what a
  // stalled flush looked like: durable on disk, never sent, entirely silent.
  // Queued-and-not-syncing means offline or stuck, and both deserve saying.
  const stalled = state.pending > 0 && !state.syncing;
  if (!state.error && !stalled) return null;

  const waiting = `${state.pending} change${state.pending === 1 ? '' : 's'} waiting.`;

  return (
    <div role="status" className="border-b border-ink-600 bg-ink-700 px-4 py-3">
      <p className={`type-note ${state.error ? 'text-t-critical' : 'text-text-mid'}`}>
        {state.error ? `${state.error} ${waiting}` : `Offline. ${waiting}`}
      </p>
    </div>
  );
}

function Shell() {
  const { session, loading } = useAuth();
  const [screen, setScreen] = useState<Screen>('today');
  const [data, setData] = useState<TodayData | null>(null);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  // Bumped to make Today refetch after Plan writes something.
  const [revision, setRevision] = useState(0);

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

      {screen === 'settings' && <Settings onBack={() => setScreen('today')} />}

      {screen === 'week' && (
        <Week
          data={data}
          onBack={() => setScreen('today')}
          onOpenAssignment={setOpenAssignment}
          onChanged={() => setRevision((r) => r + 1)}
        />
      )}

      {screen === 'month' && (
        <Month
          data={data}
          onBack={() => setScreen('today')}
          onOpenAssignment={setOpenAssignment}
          onChanged={() => setRevision((r) => r + 1)}
        />
      )}

      {screen === 'food' && <Diet onBack={() => setScreen('today')} />}

      {screen === 'ask' && (
        <Chat
          courses={data?.courses ?? []}
          onBack={() => setScreen('today')}
          onChanged={() => setRevision((r) => r + 1)}
        />
      )}

      {screen === 'plan' && (
        <Plan
          courses={data?.courses ?? []}
          onBack={() => setScreen('today')}
          onChanged={() => setRevision((r) => r + 1)}
        />
      )}

      {/* Today stays mounted so returning to it is instant and the capture box
          never loses what is half-typed in it. */}
      <div hidden={screen !== 'today'}>
        <Today
          key={revision}
          onOpenSettings={() => setScreen('settings')}
          onOpenPlan={() => setScreen('plan')}
          onOpenWeek={() => setScreen('week')}
          onOpenMonth={() => setScreen('month')}
          onOpenFood={() => setScreen('food')}
          onOpenAsk={() => setScreen('ask')}
          onData={setData}
        />
      </div>

      {/* Lives at the shell so opening a piece of work from Week does not need
          Week to know how to edit one. */}
      {openAssignment && screen !== 'today' && (
        <AssignmentEditor
          open
          assignment={openAssignment}
          courses={data?.courses ?? []}
          subtasks={data?.subtasks ?? []}
          userId={session.user.id}
          onClose={() => setOpenAssignment(null)}
          onSaved={() => setRevision((r) => r + 1)}
        />
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
