import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { capture, courseVar, FINISH_EVENT, type Assignment, type Course, type TodayData } from '../lib/planner';
import { announce } from '../lib/announce';
import { elapsedLabel, readSession, startSession, type FocusSession } from '../lib/focus';
import { islandDay } from '../lib/island';
import { layoutMatrix, MATRIX_ROWS } from '../lib/dotMatrix';
import { formatTime, formatTimeRange } from '../lib/time';
import { urgencyFor } from '../lib/urgency';
import { rowWhen } from '../lib/rowWhen';
import { useNow } from '../lib/useNow';
import { MicButton } from './MicButton';

/**
 * Vision's island: the top bar's capture box, which opens into the day.
 *
 * From NotchOwl (Nov 2026), whose whole idea is that the day is one hover
 * away rather than a window you have to find. A web page cannot live in the
 * Mac's notch, so the centre of the top bar plays that part: hover it, or
 * press Alt+N anywhere, and four cards drop out of it. Today's work, the
 * focus timer, the inbox and what is left of today.
 *
 * Every action is one the app already has. A tick finishes work through
 * Today's own finish (so it offers the actual-time chips and Undo exactly
 * as a tick on Today does); the timer is the existing count-up session that
 * FocusBar runs, and Stop goes through FocusBar so the minutes are offered
 * the same way. Nothing here writes anything new.
 *
 * Only today, never a tally of days gone (rule 3).
 *
 * "Pop out" puts the timer in a small window that stays above every app,
 * through the browser's Document Picture-in-Picture: the nearest a website
 * gets to living in the notch. Chrome and Edge have it; elsewhere the button
 * is absent rather than inert.
 */
export function VisionIsland({
  userId,
  day,
  onGo,
}: {
  userId: string;
  day: TodayData | null;
  /** Opens Today ('today') or the inbox ('week'). */
  onGo: (id: 'today' | 'week') => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hover = useRef<number | undefined>(undefined);

  const shut = useCallback(() => {
    setOpen(false);
    window.clearTimeout(hover.current);
  }, []);

  // Alt+N from anywhere; Escape closes it before the app's own Escape navigates.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // e.code, because Option+N on a Mac types a dead key, not "n".
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyN') {
        e.preventDefault();
        setOpen((was) => {
          if (!was) requestAnimationFrame(() => input.current?.focus());
          return !was;
        });
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        shut();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, shut]);

  // A click anywhere else closes it, as a menu would.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) shut();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, shut]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !userId) return;
    setText('');
    await capture(userId, body);
    announce('Added to the inbox');
    setSent(true);
    setTimeout(() => setSent(false), 1600);
  }

  return (
    <div
      ref={root}
      className="v-island"
      data-open={open || undefined}
      // Opens after a beat, so crossing the bar on the way to something else does not.
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        window.clearTimeout(hover.current);
        hover.current = window.setTimeout(() => setOpen(true), 220);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        window.clearTimeout(hover.current);
        // Stays while you are typing in it; leaving only closes a glance.
        if (root.current?.contains(document.activeElement)) return;
        hover.current = window.setTimeout(() => setOpen(false), 260);
      }}
    >
      <form onSubmit={(e) => void submit(e)} className="v-pill v-capture">
        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <label className="sr-only" htmlFor="v-capture">
          Add something to the inbox
        </label>
        <input
          id="v-capture"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={sent ? 'In the inbox' : 'Add something'}
          autoComplete="off"
        />
        <MicButton value={text} onText={setText} onError={setMicNote} className="v-mic" />
        <button
          type="button"
          className="v-island-toggle"
          aria-expanded={open}
          aria-controls="v-island-panel"
          aria-keyshortcuts="Alt+N"
          aria-label={open ? 'Close today at a glance' : 'Open today at a glance'}
          onClick={() => setOpen((o) => !o)}
        >
          <kbd aria-hidden>⌥N</kbd>
        </button>
      </form>
      {micNote && (
        <p className="v-island-note" role="status">
          {micNote}
        </p>
      )}

      <div id="v-island-panel" className="v-island-panel" hidden={!open}>
        {open && <Cards day={day} onGo={(id) => (shut(), onGo(id))} />}
      </div>
    </div>
  );
}

function Cards({ day, onGo }: { day: TodayData | null; onGo: (id: 'today' | 'week') => void }) {
  const now = useNow();
  const { due, events } = islandDay(day, now);
  const course = (id: string | null) => day?.courses.find((c) => c.id === id);

  return (
    <div className="v-island-cards">
      <section className="v-card v-island-card" aria-label="Due today">
        <Head title="Today" meta={day && due.length ? `${due.length} open` : ''} />
        {!day ? (
          <p className="v-empty">Loading</p>
        ) : due.length === 0 ? (
          <p className="v-empty">Nothing due today.</p>
        ) : (
          <ul className="v-rows">
            {due.slice(0, 4).map((a) => (
              <WorkRow key={a.id} a={a} now={now} course={course(a.course_id)} />
            ))}
          </ul>
        )}
        {due.length > 4 && (
          <button type="button" className="v-sub-link v-island-more" onClick={() => onGo('today')}>
            {due.length - 4} more on Today
          </button>
        )}
      </section>

      <Focus first={due[0] ?? null} />

      <section className="v-card v-island-card" aria-label="Inbox">
        <Head title="Inbox" meta={day?.inbox.length ? `${day.inbox.length} to sort` : ''} />
        {!day ? (
          <p className="v-empty">Loading</p>
        ) : day.inbox.length === 0 ? (
          <p className="v-empty">Empty. Type or speak above to catch a thought.</p>
        ) : (
          <ul className="v-rows">
            {day.inbox.slice(0, 3).map((i) => (
              <li key={i.id}>
                <span className="type-quote truncate">{i.body}</span>
              </li>
            ))}
          </ul>
        )}
        {Boolean(day?.inbox.length) && (
          <button type="button" className="v-sub-link v-island-more" onClick={() => onGo('week')}>
            Sort the inbox
          </button>
        )}
      </section>

      <section className="v-card v-island-card" aria-label="Still to come today">
        <Head title="Next up" meta="today" />
        {!day ? (
          <p className="v-empty">Loading</p>
        ) : events.length === 0 ? (
          <p className="v-empty">Nothing else on the calendar today.</p>
        ) : (
          <ul className="v-rows">
            {events.slice(0, 3).map((e) => {
              const start = new Date(e.starts_at);
              const end = e.ends_at ? new Date(e.ends_at) : null;
              const live = !e.all_day && start <= now;
              const c = course(e.course_id);
              return (
                <li key={e.id} className="v-island-ev">
                  <Dot course={c} />
                  <span className="v-island-ev-text">
                    <span className="truncate">{e.title}</span>
                    <span className="v-when" style={live ? { color: 'var(--t-approaching)' } : undefined}>
                      {e.all_day ? 'All day' : live ? (end ? `Now, until ${formatTime(end)}` : 'Now') : formatTimeRange(start, end)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Head({ title, meta }: { title: string; meta: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="v-h">{title}</h2>
      <span className="v-meta">{meta}</span>
    </div>
  );
}

function WorkRow({ a, now, course }: { a: Assignment; now: Date; course: Course | undefined }) {
  const due = a.due_at ? new Date(a.due_at) : null;
  const u = urgencyFor(due, { now });
  const when = rowWhen(u, due, a.due_has_time, now);
  return (
    <li>
      <button
        type="button"
        className="v-tick"
        aria-label={`Mark ${a.title} done`}
        // Today's own finish: the same Undo and actual-time chips as a tick there.
        onClick={() => window.dispatchEvent(new CustomEvent(FINISH_EVENT, { detail: a.id }))}
      />
      <span className="v-row-main">
        <Dot course={course} />
        <span className="truncate">{a.title}</span>
      </span>
      {when && (
        <span className="v-when" style={{ color: `var(${u.colourVar})` }}>
          {when}
        </span>
      )}
    </li>
  );
}

function Dot({ course }: { course: Course | undefined }) {
  if (!course?.colour_index) return null;
  return <span aria-hidden className="v-dot" style={{ background: `var(${courseVar(course.colour_index)})` }} />;
}

/* ---- focus ---------------------------------------------------------------- */

/** The running session, re-read each second: FocusBar owns it, this only shows it. */
function useSession(): FocusSession | null {
  const [session, setSession] = useState(() => readSession());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setSession(readSession());
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return session;
}

const pipSupported = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

function Focus({ first }: { first: Assignment | null }) {
  const session = useSession();
  const [pip, setPip] = useState<Window | null>(null);

  useEffect(() => () => pip?.close(), [pip]);

  async function popOut() {
    const api = (window as unknown as { documentPictureInPicture: { requestWindow(o: { width: number; height: number }): Promise<Window> } })
      .documentPictureInPicture;
    const w = await api.requestWindow({ width: 260, height: 150 });
    // The same stylesheets and the same theme attributes, so the window wears the app's tokens.
    for (const sheet of [...document.styleSheets]) {
      try {
        const style = w.document.createElement('style');
        style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
        w.document.head.append(style);
      } catch {
        if (sheet.href) {
          const link = w.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          w.document.head.append(link);
        }
      }
    }
    for (const { name, value } of [...document.documentElement.attributes]) w.document.documentElement.setAttribute(name, value);
    w.document.body.className = 'v-pip';
    w.addEventListener('pagehide', () => setPip(null));
    setPip(w);
  }

  const body = (
    <>
      <Matrix text={session ? elapsedLabel(session) : '00:00'} />
      <p className="v-island-focus-title truncate">{session ? session.title : first ? first.title : 'Nothing due today to time'}</p>
      <div className="v-island-actions">
        {session ? (
          <button type="button" className="v-primary" onClick={() => window.dispatchEvent(new CustomEvent('planner:focus-stop'))}>
            Stop
          </button>
        ) : (
          first && (
            <button
              type="button"
              className="v-primary"
              onClick={() => {
                startSession(first.id, first.title);
                announce(`Timing ${first.title}`);
              }}
            >
              Start
            </button>
          )
        )}
      </div>
    </>
  );

  return (
    <section className="v-card v-island-card v-island-focus" aria-label="Focus timer">
      <Head
        title="Focus"
        meta={
          pipSupported() && !pip ? (
            <button type="button" className="v-sub-link" onClick={() => void popOut()}>
              Pop out
            </button>
          ) : session ? (
            'Running'
          ) : (
            ''
          )
        }
      />
      {pip ? <p className="v-empty">In its own window, above your other apps.</p> : body}
      {pip && createPortal(<div className="v-pip-inner">{body}</div>, pip.document.body)}
    </section>
  );
}

function Matrix({ text }: { text: string }) {
  const { dots, cols } = layoutMatrix(text);
  return (
    <span role="timer" aria-label={`${text} elapsed`} className="v-island-matrix">
      <svg aria-hidden viewBox={`0 0 ${cols * 10} ${MATRIX_ROWS * 10}`}>
        {dots.map((d) => (
          <circle key={`${d.x}.${d.y}`} cx={d.x * 10 + 5} cy={d.y * 10 + 5} r={3.7} className={d.on ? 'dot-clock-on' : 'dot-clock-off'} />
        ))}
      </svg>
    </span>
  );
}
