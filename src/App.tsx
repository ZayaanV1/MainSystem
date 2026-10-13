import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, Page, type NavItem } from './components/AppShell';
import { keepFeedsLive } from './lib/feeds';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SheetPresence } from './components/Sheet';
import { withTransition, directionBetween } from './lib/transition';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { setOutboxOwner, startOutbox } from './lib/outbox';
import { SyncBanner } from './components/SyncBanner';
import { refreshSubscription } from './lib/notifications';
import {
  adoptAccountTimezone,
  loadAssignment,
  needsOnboarding,
  type Assignment,
  type InboxItem,
  type TodayData,
} from './lib/planner';
import { formatDay, localDayKey, todayKey, type DayKey } from './lib/time';
/*
 * Split by route.
 *
 * The whole app used to be one 736 KB chunk — 217 KB gzipped — so opening
 * Today downloaded and parsed the chatbot, the syllabus importer, the calendar
 * views and every screen nobody had asked for. Rule 1
 * gives Today two seconds on whatever phone is in someone's hand, and most of
 * that budget was being spent before a single deadline rendered.
 *
 * Three things stay eager on purpose. Today is the default screen and must not
 * wait on a network round trip for its own code. SignIn and Onboarding are the
 * first thing a new session sees, and a chunk fetch there is a blank screen at
 * the worst possible moment — the one CLAUDE.md calls the most important
 * screen in the build.
 */
// Signed-in opens, which are nearly all of them, never show this.
const SignIn = lazy(() => import('./routes/SignIn').then((m) => ({ default: m.SignIn })));
const NewPassword = lazy(() => import('./routes/SignIn').then((m) => ({ default: m.NewPassword })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })));
import { Today } from './routes/Today';

const Plan = lazy(() => import('./routes/Plan').then((m) => ({ default: m.Plan })));
const Week = lazy(() => import('./routes/Week').then((m) => ({ default: m.Week })));
const Month = lazy(() => import('./routes/Month').then((m) => ({ default: m.Month })));
const Chat = lazy(() => import('./routes/Chat').then((m) => ({ default: m.Chat })));
const Search = lazy(() => import('./routes/Search').then((m) => ({ default: m.Search })));
const AssignmentEditor = lazy(() => import('./routes/AssignmentEditor').then((m) => ({ default: m.AssignmentEditor })));
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })));
const Specimen = lazy(() => import('./routes/Specimen').then((m) => ({ default: m.Specimen })));

// The first run happens once per account; nobody else should download it.
const Onboarding = lazy(() => import('./routes/Onboarding').then((m) => ({ default: m.Onboarding })));
// Already in the first chunk, because Today renders it; static here too.
const Triage = lazy(() => import('./routes/Triage').then((m) => ({ default: m.Triage })));
import { useHotkeys } from './lib/useHotkeys';
import { FocusBar } from './components/FocusBar';
import { FocusResult } from './components/FocusResult';

/**
 * Routing is a piece of state rather than a dependency.
 *
 * Screens and open items are addresses now (lib/route.ts): the back gesture
 * works, a notification can open what it is about, and a reload stays where
 * it was. Hand-rolled; the mapping is one small file.
 */
import { currentRoute, formatRoute, type Route, type Screen } from './lib/route';
import { adoptPreferences, moduleOn, usePreferences } from './lib/preferences';
import { EmptyState } from './components/EmptyState';
import { applyBadge, badgeCount } from './lib/badge';
import type { Command } from './components/CommandPalette';
import { applyTheme, writeTheme } from './lib/theme';
import { Button } from './components/Button';

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
  { id: 'search', label: 'Search', icon: icon('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35') },
  { id: 'ask', label: 'Abood', icon: icon('M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z') },
  { id: 'plan', label: 'Courses', icon: icon('M4 6h16M4 12h10M4 18h7') },
  { id: 'settings', label: 'Settings', icon: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z') },
];

/** Shown before setup has been run, instead of a white screen and a console error. */
function NotConfigured() {
  return (
    <main className="mx-auto flex min-h-svh max-w-100 flex-col justify-center px-6">
      <h1 className="type-h1 mb-2 text-text-hi">Not set up yet</h1>
      <p className="type-body text-text-mid">
        No Supabase connection is configured. Copy .env.setup.example to .env.setup, fill it in,
        and run npm run setup.
      </p>
    </main>
  );
}

function Shell() {
  const { session, loading, recovering } = useAuth();
  const [screen, setScreen] = useState<Screen>(() => currentRoute().screen);

  /**
   * Screen changes run inside a view transition, travelling in the direction
   * you moved along the nav.
   *
   * The order is taken from NAV itself rather than written out again — a
   * second list would drift the first time an item moved, and the symptom
   * would be a screen sliding the wrong way, which reads as a glitch rather
   * than as a stale constant.
   */
  const navigate = useCallback(
    (next: Screen, extra: Omit<Route, 'screen'> = {}) => {
      // Within the same screen (Courses to a course's page, Settings to one
      // of its pages): a new address, announced the way Back announces one,
      // so the screen's own page handling moves.
      if (next === screen && (extra.course || extra.page)) {
        window.history.pushState(null, '', formatRoute({ screen: next, ...extra }));
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      if (next === screen && !extra.day) return;
      setMonthDay(next === 'month' ? (extra.day ?? null) : null);
      window.history.pushState(null, '', formatRoute({ screen: next, ...extra }));
      const order = NAV.map((item) => item.id);
      withTransition(() => setScreen(next), directionBetween(order, screen, next));
    },
    [screen],
  );

  /*
    Search is a nav item you click, which on a laptop removes most of the point
    of search. cmd/ctrl+K and a bare "/" both reach it; neither fires while you
    are typing, because a shortcut that eats a keystroke mid-sentence is worse
    than no shortcut — and "/" is exactly what someone typing a date presses.
  */
  const [palette, setPalette] = useState(false);
  useHotkeys({
    onSearch: () => navigate('search'),
    onPalette: () => setPalette((open) => !open),
    onEscape: () => {
      if (palette) setPalette(false);
      else if (openAssignment) setOpenAssignment(null);
      else if (screen !== 'today') navigate('today');
    },
  });
  const [data, setData] = useState<TodayData | null>(null);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  const [openInbox, setOpenInbox] = useState<InboxItem | null>(null);

  /** Open a piece of work by id: from the loaded day, or read on its own. */
  const openWork = useCallback(
    (id: string) => {
      const found = data?.assignments.find((a) => a.id === id) ?? data?.completedToday.find((a) => a.id === id);
      if (found) setOpenAssignment(found);
      else void loadAssignment(id).then((a) => a && setOpenAssignment(a));
    },
    [data],
  );

  /*
   * Back and Forward between screens. Sheets handle their own entries
   * (components/Sheet.tsx); this moves the screen underneath, in the
   * direction travelled along the nav.
   */
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    const onPop = () => {
      const r = currentRoute();
      setMonthDay(r.day ?? null);
      if (r.screen === screenRef.current) return;
      const order = NAV.map((item) => item.id);
      withTransition(() => setScreen(r.screen), directionBetween(order, screenRef.current, r.screen));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /*
   * An address with something open in it — a reminder's link, a reload with
   * the editor up — opens that thing once the day has loaded. The base entry
   * loses the parameter first, so the sheet's own entry carries it and Back
   * lands on the screen rather than on the same sheet again.
   */
  const [pendingOpen, setPendingOpen] = useState<Route['open'] | null>(() => currentRoute().open ?? null);
  const routeTo = useCallback((to: string) => {
    const u = new URL(to, window.location.origin);
    if (u.origin !== window.location.origin) return;
    window.history.pushState(null, '', u.pathname + u.search);
    const r = currentRoute();
    setMonthDay(r.day ?? null);
    setScreen(r.screen);
    setPendingOpen(r.open ?? null);
  }, []);
  useEffect(() => {
    if (!pendingOpen || !data) return;
    setPendingOpen(null);
    window.history.replaceState(null, '', formatRoute({ ...currentRoute(), open: undefined }));
    if (pendingOpen.kind === 'work') openWork(pendingOpen.id);
    else {
      const found = data.inbox.find((i) => i.id === pendingOpen.id);
      if (found) setOpenInbox(found);
    }
  }, [pendingOpen, data, openWork]);

  // A notification tapped while the app is already open: the service worker
  // focuses this window and asks it to go where the notification points.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; to?: unknown } | null;
      if (msg?.type === 'navigate' && typeof msg.to === 'string') routeTo(msg.to);
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [routeTo]);
  /** The day Month should open on, when an event in Search was tapped. */
  const [monthDay, setMonthDay] = useState<DayKey | null>(() => currentRoute().day ?? null);
  /**
   * A finished timer, waiting to be offered.
   *
   * Offered, never written. Rule 2 keeps marking work done free, and a timer
   * that silently recorded what it measured would make starting one a
   * commitment rather than a convenience.
   */
  const [finishedFocus, setFinishedFocus] = useState<{
    assignmentId: string;
    title: string;
    minutes: number;
  } | null>(null);
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

  /**
   * Null while unknown, so the app renders neither the planner nor the first
   * run until it knows which is correct. Flashing an empty Today for a frame
   * and then replacing it with a welcome screen is a worse first impression
   * than a beat of nothing.
   */
  const [firstRun, setFirstRun] = useState<boolean | null>(null);

  // Writes are tagged with the account that queued them, so a shared device
  // never replays one account's changes as another's.
  useEffect(() => {
    void setOutboxOwner(session?.user.id ?? null);
  }, [session]);

  useEffect(() => {
    if (!session) return;

    void adoptAccountTimezone(session.user.id).finally(() => setZoneReady(true));
    // The account's theme, Today's arrangement and its modules; cached, so
    // this only corrects a device that has not seen the latest choice.
    void adoptPreferences();
    void needsOnboarding().then(setFirstRun).catch(() => setFirstRun(false));

    startOutbox();

    // iOS invalidates push subscriptions while the app is closed and says
    // nothing. Re-subscribing on every launch is the only defence.
    void refreshSubscription();
  }, [session]);

  /*
   * Subscribed calendars, kept current while the app is in front.
   *
   * Waits for the zone, because the server mirrors a window of days computed
   * in the account's zone and an early sync from a device that has not
   * adopted it yet gains nothing. Before any subscription exists this is one
   * cheap request that finds no feeds.
   */
  const prefs = usePreferences();
  const feedsOn = moduleOn('feeds', prefs);
  useEffect(() => {
    if (!session || !zoneReady || !feedsOn) return;
    return keepFeedsLive();
  }, [session, zoneReady, feedsOn]);

  // Today's count on the home-screen icon (lib/badge.ts), kept current as
  // the day loads and as work is ticked off.
  useEffect(() => {
    if (data) void applyBadge(badgeCount(data.assignments, todayKey()));
  }, [data]);

  // A switched-off module leaves the tab bar; its screen stays reachable by
  // address and says how to bring it back rather than going blank.
  const nav = useMemo(() => NAV.filter((item) => item.id !== 'ask' || moduleOn('abood', prefs)), [prefs]);

  // The command palette's entries, built only while it is open. Each runs the
  // same function a tap would (components/CommandPalette.tsx).
  const commands = useMemo<Command[]>(() => {
    if (!palette) return [];
    const list: Command[] = [
      {
        id: 'do-capture',
        group: 'Do',
        label: 'Capture a thought',
        keywords: 'add new inbox note write',
        run: () => {
          navigate('today');
          window.setTimeout(() => document.getElementById('capture')?.focus(), 380);
        },
      },
      {
        id: 'do-mode',
        group: 'Do',
        label: 'Switch light or dark',
        keywords: 'theme mode night day appearance',
        run: () => {
          const t = document.documentElement.getAttribute('data-theme');
          const dark = t ? t === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
          const next = dark ? 'light' : 'dark';
          withTransition(() => {
            writeTheme(next);
            applyTheme(next);
          });
        },
      },
      ...nav.map((item) => ({ id: `go-${item.id}`, group: 'Go to' as const, label: item.label, run: () => navigate(item.id) })),
    ];
    const pages: [string, string, string?][] = [
      ['notifications', 'Notifications and digest', 'push morning digest weekly review badge'],
      ['timezone', 'Time zone', 'zone clock'],
      ['appearance', 'Appearance', 'theme dark light glass motion slips'],
      ['arrange', 'Today and modules', 'arrange order hide sections modules switch off'],
      ...(moduleOn('feeds', prefs) ? ([['calendar', 'Calendar feed', 'ics subscribe google apple outlook']] as [string, string, string][]) : []),
      ['abood', moduleOn('abood', prefs) ? 'Abood' : 'AI keys', 'groq gemini key telegram imessage memory'],
      ['data', 'Your data', 'export json csv delete account'],
    ];
    for (const [page, label, keywords] of pages)
      list.push({ id: `set-${page}`, group: 'Settings', label, keywords, run: () => navigate('settings', { page }) });
    const courses = data?.courses ?? [];
    for (const a of data?.assignments ?? []) {
      if (a.status === 'done') continue;
      const course = courses.find((c) => c.id === a.course_id);
      list.push({
        id: `work-${a.id}`,
        group: 'Work',
        label: a.title,
        hint: [course?.code ?? course?.name, a.due_at ? formatDay(localDayKey(new Date(a.due_at))) : null].filter(Boolean).join(' · '),
        run: () => openWork(a.id),
      });
    }
    for (const c of courses)
      list.push({ id: `course-${c.id}`, group: 'Courses', label: c.code ?? c.name, keywords: c.name, hint: c.code ? c.name : undefined, run: () => navigate('plan', { course: c.id }) });
    return list;
  }, [palette, nav, prefs, data, navigate, openWork]);

  // Nothing is rendered until the stored session has been read back, so the
  // sign-in screen does not flash on every launch.
  if (loading) return null;

  if (!session)
    return (
      <Suspense fallback={null}>
        <SignIn />
      </Suspense>
    );

  // Opened from a reset email: the new password comes first.
  if (recovering)
    return (
      <Suspense fallback={null}>
        <NewPassword />
      </Suspense>
    );

  if (!zoneReady || firstRun === null) return null;

  if (firstRun) {
    return (
      <Suspense fallback={null}>
        <Onboarding
          userId={session.user.id}
          onDone={() => {
            setFirstRun(false);
            // The planner behind it is stale by definition — the first run
            // just created everything in it.
            setRevision((r) => r + 1);
          }}
        />
      </Suspense>
    );
  }

  /** The screen itself. Today is handled separately; see below. */
  function renderScreen() {
    const home = () => setScreen('today');
    const bumped = () => setRevision((r) => r + 1);

    switch (screen) {
      case 'settings':
        return <Settings />;
      case 'week':
        return (
          <Week
            data={data}
            onOpenAssignment={setOpenAssignment}
            onPlan={() => navigate('plan')}
            onChanged={bumped}
          />
        );
      case 'month':
        return (
          <Month data={data} onOpenAssignment={setOpenAssignment} initialDay={monthDay} />
        );
      case 'search':
        return (
          <Search
            data={data}
            onOpenAssignment={openWork}
            onOpenDay={(day) => navigate('month', { day })}
            onOpenInbox={(id) => {
              const found = data?.inbox.find((i) => i.id === id);
              if (found) setOpenInbox(found);
            }}
            onOpenCourse={(course) => navigate('plan', { course })}
          />
        );
      case 'ask':
        if (!moduleOn('abood', prefs))
          return (
            <main className="page-frame">
              <h1 className="page-title mb-6 px-4">Abood</h1>
              <EmptyState
                action={
                  <Button variant="secondary" onClick={() => navigate('settings', { page: 'arrange' })}>
                    Today and modules
                  </Button>
                }
              >
                Abood is switched off. Everything it remembered is kept, and switching it back on brings it all back.
              </EmptyState>
            </main>
          );
        return <Chat courses={data?.courses ?? []} onBack={home} onChanged={bumped} />;
      case 'plan':
        return <Plan courses={data?.courses ?? []} onBack={home} onChanged={bumped} onOpenWork={openWork} />;
      default:
        return null;
    }
  }

  return (
    <AppShell current={screen} items={nav} onNavigate={navigate}>
      <SyncBanner />

      {palette && (
        <Suspense fallback={null}>
          <CommandPalette commands={commands} onClose={() => setPalette(false)} />
        </Suspense>
      )}

      {/*
        Above every screen, because a timer you have to navigate back to is a
        timer you forget is running — and a forgotten one records a wrong
        number into the calibration median, which is worse than recording
        nothing.
      */}
      <FocusBar
        onFinish={(assignmentId, title, minutes) =>
          setFinishedFocus({ assignmentId, title, minutes })
        }
      />

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
      {screen !== 'today' && (
        <Page key={screen}>
          {/*
            The fallback is deliberately blank. A screen change is already
            inside a view transition, and a spinner appearing for 80ms in the
            middle of that animation reads as a glitch rather than as loading.
            The old screen stays painted until the new one is ready.
          */}
          <ErrorBoundary key={screen}>
            <Suspense fallback={null}>{renderScreen()}</Suspense>
          </ErrorBoundary>
        </Page>
      )}

      {/* Today stays mounted so returning to it is instant and the capture box
          never loses what is half-typed in it. */}
      <div hidden={screen !== 'today'}>
        {/* Re-read in place when another screen writes, never remounted: a
            remount threw away anything half-typed in the capture box. */}
        <ErrorBoundary>
          <Today refresh={revision} onData={setData} />
        </ErrorBoundary>
      </div>

      {/* Lives at the shell so opening a piece of work from Week does not need
          Week to know how to edit one. */}
      <SheetPresence>
      {openAssignment && (
        <Suspense fallback={null}>
          <AssignmentEditor
            open
            // Keeps the course page under it in the address, so a reload with
            // the editor open lands back on the same page.
            url={formatRoute({ ...currentRoute(), screen, open: { kind: 'work', id: openAssignment.id } })}
            assignment={openAssignment}
            courses={data?.courses ?? []}
            subtasks={data?.subtasks ?? []}
            userId={session.user.id}
            onClose={() => setOpenAssignment(null)}
            onSaved={() => setRevision((r) => r + 1)}
          />
        </Suspense>
      )}
      </SheetPresence>
      <SheetPresence>
      {openInbox && (
        <Suspense fallback={null}>
          <Triage
            url={formatRoute({ screen, open: { kind: 'inbox', id: openInbox.id } })}
            item={openInbox}
            courses={data?.courses ?? []}
            userId={session.user.id}
            onClose={() => setOpenInbox(null)}
            onDone={() => setOpenInbox(null)}
          />
        </Suspense>
      )}
      </SheetPresence>
      <SheetPresence>
      {finishedFocus && (
        <FocusResult
          {...finishedFocus}
          onDone={() => {
            setFinishedFocus(null);
            setRevision((r) => r + 1);
          }}
        />
      )}
      </SheetPresence>

    </AppShell>
  );
}

/** The specimen inside the real shell, so the tab bar and rail are checked too. */
function SpecimenShell() {
  const [current, setCurrent] = useState<Screen>('today');
  return (
    <AppShell current={current} items={NAV} onNavigate={setCurrent}>
      <Specimen />
    </AppShell>
  );
}

export default function App() {
  // The design system specimen, in development only. Never reachable in a
  // production build, and tree-shaken out of it entirely.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('specimen')) {
    return <SpecimenShell />;
  }

  if (!isConfigured) return <NotConfigured />;

  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
