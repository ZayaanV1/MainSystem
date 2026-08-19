import { useEffect, useState } from 'react';
import { AppShell, Page, type NavItem } from './components/AppShell';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { startOutbox, subscribeOutbox, type OutboxState } from './lib/outbox';
import { refreshSubscription } from './lib/notifications';
import { adoptAccountTimezone, type Assignment, type TodayData } from './lib/planner';
import { SignIn } from './routes/SignIn';
import { Today } from './routes/Today';
import { Plan } from './routes/Plan';
import { Week } from './routes/Week';
import { Month } from './routes/Month';
import { Chat } from './routes/Chat';
import { Search } from './routes/Search';
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
type Screen = 'today' | 'week' | 'month' | 'plan' | 'food' | 'ask' | 'search' | 'settings';

/**
 * The rail's contents.
 *
 * Order is by how often a screen is opened, not alphabetically and not by how
 * much work went into it. Today first because it is the answer to the question
 * the app exists to answer.
 */
const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const NAV: NavItem<Screen>[] = [
  { id: 'today', label: 'Today', icon: icon('M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0') },
  { id: 'week', label: 'Week', icon: icon('M3 9h18M8 3v4M16 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2') },
  { id: 'month', label: 'Month', icon: icon('M3 10h18M7 3v4M17 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2M8 14h.01M12 14h.01M16 14h.01') },
  { id: 'food', label: 'Diet tracker', short: 'Diet', icon: icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8') },
  { id: 'search', label: 'Search', icon: icon('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35') },
  { id: 'ask', label: 'Abood', icon: icon('M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z') },
  { id: 'plan', label: 'Courses', icon: icon('M4 6h16M4 12h10M4 18h7') },
  { id: 'settings', label: 'Settings', icon: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z') },
];

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

  /**
   * Whether the account's timezone has been read yet.
   *
   * Nothing renders until it has. Every "today" in the app resolves through
   * the active zone, so a screen painted before it is known is a screen that
   * computed the wrong day for anyone outside the browser's zone — and on a
   * night either side of midnight, wrong by a whole day.
   */
  const [zoneReady, setZoneReady] = useState(false);

  useEffect(() => {
    if (!session) return;

    void adoptAccountTimezone().finally(() => setZoneReady(true));

    startOutbox();

    // iOS invalidates push subscriptions while the app is closed and says
    // nothing. Re-subscribing on every launch is the only defence.
    void refreshSubscription();
  }, [session]);

  // Nothing is rendered until the stored session has been read back, so the
  // sign-in screen does not flash on every launch.
  if (loading) return null;

  if (!session) return <SignIn />;

  if (!zoneReady) return null;

  /** The screen itself. Today is handled separately; see below. */
  function renderScreen() {
    const home = () => setScreen('today');
    const bumped = () => setRevision((r) => r + 1);

    switch (screen) {
      case 'settings':
        return <Settings onBack={home} />;
      case 'week':
        return (
          <Week data={data} onBack={home} onOpenAssignment={setOpenAssignment} onChanged={bumped} />
        );
      case 'month':
        return (
          <Month data={data} onBack={home} onOpenAssignment={setOpenAssignment} onChanged={bumped} />
        );
      case 'food':
        return <Diet onBack={home} />;
      case 'search':
        return (
          <Search
            onBack={home}
            onOpenAssignment={(id) => {
              const found = data?.assignments.find((a) => a.id === id);
              if (found) setOpenAssignment(found);
            }}
          />
        );
      case 'ask':
        return <Chat courses={data?.courses ?? []} onBack={home} onChanged={bumped} />;
      case 'plan':
        return <Plan courses={data?.courses ?? []} onBack={home} onChanged={bumped} />;
      default:
        return null;
    }
  }

  return (
    <AppShell current={screen} items={NAV} onNavigate={setScreen}>
      <SyncBanner />

      {/*
        Keyed by screen, so React unmounts the old one and mounts the new, and
        the new one animates in.

        There is no AnimatePresence here and no exit animation, which is a
        deliberate trade. Wrapping these in AnimatePresence left pages mounted
        at opacity 0 instead of removing them — with `mode="wait"` it deadlocked
        after the first exit, and without it the pages simply accumulated. A
        screen that never unmounts keeps its timers, its subscriptions and its
        stale data alive behind the one you are looking at, which is a far worse
        bug than a missing fade on the way out.

        Entering is the half you actually watch. Leaving is a cut.
      */}
      {screen !== 'today' && <Page key={screen}>{renderScreen()}</Page>}

      {/* Today stays mounted so returning to it is instant and the capture box
          never loses what is half-typed in it. */}
      <div hidden={screen !== 'today'}>
        <Today
          key={revision}
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
    </AppShell>
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
