import { useEffect, useState } from 'react';
import { Button } from './Button';
import {
  clearSession,
  elapsedLabel,
  elapsedMinutes,
  readSession,
  type FocusSession,
} from '../lib/focus';

/**
 * The running timer, pinned above the tab bar.
 *
 * Visible from every screen on purpose. A timer you have to navigate back to
 * is a timer you forget is running, and a forgotten one records a wrong number
 * into the calibration median — worse than recording nothing, because the
 * median is meant to be the trustworthy figure.
 *
 * ONE SESSION AT A TIME
 *
 * Starting a second replaces the first rather than queueing it, and there is
 * no way to have two. Two running timers is two answers to "what am I doing",
 * on a screen whose entire job is to have one.
 *
 * STOPPING OFFERS THE NUMBER, IT DOES NOT WRITE IT
 *
 * Rule 2 says marking work done has to stay free, and the same reasoning
 * applies here: a timer that silently records what it measured would make
 * starting one a commitment. So it hands the minutes to the caller, which
 * shows them in the same optional chip row that already exists for this, and
 * discarding is one tap.
 */

interface FocusBarProps {
  /** Given the elapsed minutes when the session ends by being stopped. */
  onFinish: (assignmentId: string, title: string, minutes: number) => void;
}

export function FocusBar({ onFinish }: FocusBarProps) {
  const [session, setSession] = useState<FocusSession | null>(() => readSession());
  const [, tick] = useState(0);

  /*
   * The clock is re-rendered every second, but elapsed is always DERIVED from
   * the stored start instant rather than accumulated here. A counter that adds
   * one per tick drifts the moment the tab is backgrounded, throttled or
   * frozen — which on a phone is most of the time a timer is running.
   */
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [session]);

  // Another screen may have started or cleared a session. Cheap to re-read,
  // and it keeps this honest without a store.
  useEffect(() => {
    const id = setInterval(() => {
      const current = readSession();
      setSession((prev) =>
        prev?.startedAt === current?.startedAt && prev?.assignmentId === current?.assignmentId
          ? prev
          : current,
      );
    }, 2000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  function stop() {
    if (!session) return;
    const minutes = elapsedMinutes(session);
    clearSession();
    setSession(null);
    onFinish(session.assignmentId, session.title, minutes);
  }

  function discard() {
    clearSession();
    setSession(null);
  }

  return (
    <div
      // Above the tab bar, below a sheet. Fixed so it survives every screen.
      className="fx-glass fixed inset-x-0 bottom-[calc(var(--tab-bar)+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 border-t border-ink-600 px-4 py-2 lg:bottom-0"
    >
      <span
        // Polite and atomic: it changes every second, and announcing each tick
        // would make the app unusable with a screen reader. aria-hidden on the
        // clock itself, with a single summary for assistive technology.
        aria-hidden
        className="type-h2 tabular-nums text-text-hi"
      >
        {elapsedLabel(session)}
      </span>
      <span className="sr-only" role="timer">
        Working on {session.title}
      </span>

      <span className="type-note min-w-0 flex-1 truncate text-text-mid">{session.title}</span>

      <Button variant="primary" size="sm" onClick={stop}>
        Stop
      </Button>
      <Button variant="quiet" size="sm" onClick={discard} aria-label="Discard this timer">
        Discard
      </Button>
    </div>
  );
}
