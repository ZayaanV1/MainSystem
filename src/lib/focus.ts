/**
 * A timer for the thing you just decided to do.
 *
 * The app already has an estimate-versus-actual calibration engine: it takes
 * the median once there are five samples and stays silent below that. Nothing
 * has ever fed it except a chip row that appears after you finish something
 * and can be ignored — which it usually is, correctly, because rule 2 says
 * marking work done must stay free.
 *
 * So the calibration has been sitting there with almost nothing to calibrate
 * on. A timer is the honest source: it measures rather than asks.
 *
 * WHAT THIS IS NOT
 *
 * Not a Pomodoro. No enforced twenty-five minutes, no mandatory break, no
 * cycle count. Those are a productivity system with opinions about how a
 * person should work, and importing one into a planner that is supposed to
 * reduce friction adds a second set of rules to comply with. It counts up,
 * and it stops when you stop.
 *
 * There is also no score. The scope list forbids gamification and rule 3
 * forbids anything accumulating across days, so nothing here totals focus
 * time, compares this week to last, or awards anything. One session, one
 * number, offered once.
 *
 * WHY IT SURVIVES A RELOAD
 *
 * It lives in localStorage rather than React state. A phone backgrounds the
 * browser the moment you switch to anything else, and a timer that dies when
 * you look at a PDF is a timer that measures nothing. Elapsed time is derived
 * from a stored start instant rather than counted by an interval, so it stays
 * correct across a background, a reload and a lock screen — an interval is
 * throttled or killed in all three.
 */

const KEY = 'planner.focus';

export interface FocusSession {
  assignmentId: string;
  title: string;
  /** Epoch ms. The only thing stored; elapsed is always derived from it. */
  startedAt: number;
}

export function readSession(): FocusSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FocusSession>;
    if (
      typeof parsed?.assignmentId !== 'string' ||
      typeof parsed?.title !== 'string' ||
      typeof parsed?.startedAt !== 'number'
    ) {
      return null;
    }

    /*
     * A session older than twelve hours is a forgotten one, not a long one.
     * Someone who started a timer and closed the app should not come back
     * tomorrow to a running clock offering to record nine hours against a
     * lab report — a number that wrong would poison the median it feeds.
     */
    if (Date.now() - parsed.startedAt > 12 * 60 * 60 * 1000) {
      clearSession();
      return null;
    }

    return parsed as FocusSession;
  } catch {
    return null;
  }
}

export function startSession(assignmentId: string, title: string): FocusSession {
  const session: FocusSession = { assignmentId, title, startedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable. The timer still runs for this session; it simply
    // will not survive a reload, which is a degradation rather than a failure.
  }
  return session;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Whole minutes elapsed, rounded to the nearest.
 *
 * Rounded rather than floored so a 90-second start-and-stop reads as 2 rather
 * than 1 — and so the number offered matches what the clock on screen was
 * showing a moment earlier, which is the only figure the person actually saw.
 */
export function elapsedMinutes(session: FocusSession, now: number = Date.now()): number {
  return Math.max(0, Math.round((now - session.startedAt) / 60_000));
}

/** `mm:ss` while under an hour, `h:mm:ss` past it. */
export function elapsedLabel(session: FocusSession, now: number = Date.now()): string {
  const total = Math.max(0, Math.floor((now - session.startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
