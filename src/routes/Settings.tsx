import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { applyTheme, readTheme, writeTheme, type ThemeChoice } from '../lib/theme';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../lib/auth';
import { exportCsv, exportJson } from '../lib/export';
import { fetchDeliveryLog, type DeliveryRow } from '../lib/health';
import { pushStatus, subscribeToPush, type PushStatus } from '../lib/notifications';
import { subscribeSw, type SwState } from '../lib/sw';
import { DigestSettings } from './DigestSettings';
import {
  deleteAccount, calendarFeedUrl, hasOwnApiKey, setOwnApiKey } from '../lib/planner';
import { supabase } from '../lib/supabase';
import { formatDay, formatTime, localDayKey } from '../lib/time';

/**
 * Settings.
 *
 * In Phase 0 this is mostly the proof surface: is the notification pipeline
 * alive, and can I get my data out. Both questions have to be answerable
 * without opening a database console.
 */

const PUSH_COPY: Record<PushStatus, string> = {
  unsupported: 'This browser cannot receive push notifications.',
  'needs-install': 'Add the app to your home screen first. iOS requires it for push.',
  'needs-permission': 'Push is not enabled on this device.',
  denied: 'Notifications are blocked. Change this in iOS Settings, then reload.',
  'no-service-worker':
    'The service worker has not started, so push cannot be set up. Close the app fully and reopen it.',
  'device-only':
    'This device is subscribed, but the server has no record of it — so nothing would be delivered. Register it again.',
  subscribed: 'Push is enabled, and the server knows about this device.',
};

export function Settings({ onBack }: { onBack: () => void }) {
  const { signOut, session } = useAuth();
  const userId = session?.user.id ?? '';

  const [log, setLog] = useState<DeliveryRow[]>([]);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sw, setSw] = useState<SwState>({ status: 'registering' });

  useEffect(() => subscribeSw(setSw), []);

  const reload = useCallback(async () => {
    const [rows, status] = await Promise.all([fetchDeliveryLog(), pushStatus()]);
    setLog(rows);
    setPush(status);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function sendTest() {
    setTesting(true);
    setMessage(null);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not signed in.');

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dispatch`, {
        method: 'POST',
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const body = await res.json();

      setMessage(
        res.ok && body.delivered
          ? `Sent via ${body.channel}. Check your phone.`
          : `Couldn't send. ${body.errors?.join('; ') ?? `HTTP ${res.status}`}`,
      );
    } catch (e) {
      // Safari reports every blocked or failed request as "Load failed", which
      // tells you nothing. The overwhelmingly likely cause is that the server
      // does not recognise this origin, so say that instead of repeating it.
      const raw = (e as Error).message;
      setMessage(
        /load failed|failed to fetch|networkerror/i.test(raw)
          ? "Couldn't reach the server. Check your connection and try again."
          : `Couldn't send. ${raw}`,
      );
    } finally {
      setTesting(false);
      void reload();
    }
  }

  async function enablePush() {
    setMessage(null);
    const result = await subscribeToPush();
    setMessage(result.ok ? 'Push enabled on this device.' : `Couldn't enable push. ${result.error}`);
    void reload();
  }

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Settings</h1>
        <Button variant="quiet" onClick={onBack}>
          Today
        </Button>
      </header>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Notifications</h2>

        <Card className="p-4">
          <p className="type-body text-text-mid">{push ? PUSH_COPY[push] : 'Checking.'}</p>

          {/* The registration result, stated outright. This failed silently
              for two days: no registration, no error, and a status line
              confidently reporting success. */}
          {sw.status === 'failed' && (
            <p className="mt-2 type-note text-t-overdue">
              Service worker did not register: {sw.error}
            </p>
          )}
          {sw.status === 'unsupported' && (
            <p className="mt-2 max-w-prose type-note text-text-low">
              This browser has no service worker support.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" onClick={sendTest} disabled={testing}>
              {testing ? 'Sending' : 'Send test notification'}
            </Button>

            {/* Offered for every state a tap can actually fix. Hiding it when
                the browser claimed success is what let a half-registered
                device sit there looking fine. */}
            {(push === 'needs-permission' ||
              push === 'device-only' ||
              push === 'no-service-worker') && (
              <Button onClick={enablePush}>
                {push === 'device-only' ? 'Register this device' : 'Enable push here'}
              </Button>
            )}
          </div>

          {message && <p className="type-caption mt-4 text-text-mid">{message}</p>}
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Morning digest</h2>
        <DigestSettings />
      </section>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Delivery log</h2>

        {log.length === 0 ? (
          <EmptyState>No delivery attempts recorded yet.</EmptyState>
        ) : (
          <Card>
            {log.map((row) => (
              <div
                key={row.id}
                className="flex items-baseline gap-3 border-b border-ink-600 px-4 py-3 last:border-b-0"
              >
                <span
                  aria-hidden
                  className={[
                    'h-2 w-2 shrink-0 rounded-pill',
                    row.status === 'sent'
                      ? 'bg-t-done'
                      : row.status === 'failed'
                        ? 'bg-t-overdue'
                        : 'bg-text-low',
                  ].join(' ')}
                />

                <div className="flex-1">
                  {/* Status is written as well as coloured — colour is never
                      the only signal, including here. */}
                  <div className="type-label text-text-hi">
                    {row.status} &middot; {row.kind}
                    {row.channel ? ` · ${row.channel}` : ''}
                  </div>
                  {row.error && <div className="type-caption text-text-mid">{row.error}</div>}
                </div>

                <span className="type-caption shrink-0 text-text-low">
                  {formatDay(localDayKey(new Date(row.created_at)))}{' '}
                  {formatTime(new Date(row.created_at))}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <ApiKey userId={userId} />

      <CalendarFeed userId={userId} />

      <Appearance />

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Your data</h2>
        <Card className="p-4">
          <p className="type-body mb-4 text-text-mid">
            Everything this app holds, in one file. You can leave whenever you want.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void exportJson()}>Export JSON</Button>
            <Button onClick={() => void exportCsv()}>Export CSV</Button>
          </div>
        </Card>
      </section>

      <DeleteAccount />

      <section className="mb-12">
        <Button variant="quiet" onClick={() => void signOut()}>
          Sign out
        </Button>
      </section>
    </main>
  );
}

/**
 * The subscribable calendar link.
 *
 * Deadlines belong where you already look. A planner you have to remember to
 * open is competing with the calendar app on your lock screen, and it loses.
 *
 * The warning is not boilerplate. This is the one URL in the app that works
 * without a login, because a calendar app cannot present one — so anyone the
 * link reaches can read your deadlines until it is rotated. Saying that
 * plainly, next to the button that reveals it, is the whole safeguard.
 */
function CalendarFeed({ userId }: { userId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reveal(rotate = false) {
    setBusy(true);
    setCopied(false);
    const next = await calendarFeedUrl(userId, rotate);
    setUrl(next);
    setBusy(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access is refused in some contexts; the field below is
      // selectable, so this is a missing convenience rather than a failure.
      setCopied(false);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="type-h2 mb-1 px-4 text-text-hi">Calendar feed</h2>
      <p className="type-note mb-3 max-w-prose px-4 text-text-low">
        Subscribe to this in any calendar app and your deadlines appear there. Titles and times
        only — never notes.
      </p>

      <div className="flex flex-col gap-3 px-4">
        {url === null ? (
          <div>
            <Button variant="quiet" disabled={busy} onClick={() => void reveal(false)}>
              {busy ? 'Getting the link' : 'Show the link'}
            </Button>
          </div>
        ) : (
          <>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-card border border-ink-600 bg-ink-800 px-4 type-quote text-text-mid"
            />
            <p className="type-note text-t-approaching">
              Anyone with this link can read your deadlines. Replace it if it goes somewhere it
              should not.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="quiet" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => void reveal(true)}>
                Replace the link
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Your own Gemini key.
 *
 * Without one, food parsing and Abood draw on a single shared free tier, which
 * means one heavy account can exhaust food logging for everyone else. Your own
 * key decouples that completely: your usage is yours, your limits are yours,
 * and the daily question budget stops applying because you are not competing
 * with anybody.
 *
 * The field is write-only. The app never reads the key back — it only asks
 * whether one is set — so there is no path by which it reaches a screenshot,
 * a bug report or a log. Saying that plainly is the point: a key box with no
 * explanation is a thing people paste into and then worry about.
 */
function ApiKey({ userId }: { userId: string }) {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void hasOwnApiKey().then(setIsSet);
  }, []);

  async function save(next: string | null) {
    setBusy(true);
    setMessage(null);
    const { error } = await setOwnApiKey(userId, next);
    setBusy(false);

    if (error) {
      setMessage(`Not saved. ${error}`);
      return;
    }

    setDraft('');
    setIsSet(Boolean(next));
    setMessage(next ? 'Saved. This account now uses your key.' : 'Removed. Back to the shared key.');
  }

  if (isSet === null) return null;

  return (
    <section className="mb-8">
      <h2 className="type-h2 mb-1 px-4 text-text-hi">Your own AI key</h2>
      <p className="type-note mb-3 max-w-prose px-4 text-text-low">
        Food parsing and Abood share one free allowance across everyone using this app. Add your
        own Gemini key and you get your own limits instead, with no daily cap on questions. It is
        stored for your account only, and the app never reads it back.
      </p>

      <div className="flex max-w-prose flex-col gap-3 px-4">
        {isSet ? (
          <>
            <p className="type-body text-text-mid">A key is set for this account.</p>
            <div>
              <Button variant="quiet" disabled={busy} onClick={() => void save(null)}>
                Remove it
              </Button>
            </div>
          </>
        ) : (
          <>
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste your Gemini API key"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-card border border-ink-600 bg-ink-800 px-4 type-body text-text-hi placeholder:text-text-low"
            />
            <p className="type-note text-text-low">
              A free key comes from aistudio.google.com. Without one, the shared allowance is used.
            </p>
            <div>
              <Button
                variant="quiet"
                disabled={busy || !draft.trim()}
                onClick={() => void save(draft)}
              >
                {busy ? 'Saving' : 'Use my key'}
              </Button>
            </div>
          </>
        )}

        {message && <p className="type-note text-text-mid">{message}</p>}
      </div>
    </section>
  );
}

/**
 * Appearance.
 *
 * Three options, not a switch, because "System" is a real state rather than
 * the absence of a choice — a phone that dims at sunset should keep doing
 * that, and a two-way toggle silently freezes whatever the OS happened to be
 * saying the first time this screen was opened.
 *
 * The preference is per-device and lives in localStorage rather than the
 * account. The same person wants dark on a phone at night and light on a
 * laptop at noon, and syncing it would make one change when the other did.
 */
function Appearance() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme());

  // Keeps this control honest if the theme is changed from somewhere else in
  // the same session — the system listener in main.tsx, for one.
  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  const options: { value: ThemeChoice; label: string; hint: string }[] = [
    { value: 'system', label: 'System', hint: 'Follows your device' },
    { value: 'light', label: 'Light', hint: 'Always light' },
    { value: 'dark', label: 'Dark', hint: 'Always dark' },
  ];

  return (
    <section className="mb-8">
      <h2 className="type-h2 mb-3 px-4 text-text-hi">Appearance</h2>
      <Card className="p-4">
        <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={choice === o.value}
              onClick={() => {
                setChoice(o.value);
                writeTheme(o.value);
              }}
              className={[
                'fx-depth min-h-[var(--tap)] rounded-pill border px-4 type-label',
                choice === o.value
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-ink-600 bg-ink-800 text-text-mid',
              ].join(' ')}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="type-note mt-3 text-text-low">
          {options.find((o) => o.value === choice)?.hint}. This is remembered on
          this device only.
        </p>
      </Card>
    </section>
  );
}

/**
 * Leaving for good.
 *
 * Typed confirmation rather than a second button. "Delete" then "Delete for
 * good" is right for one assignment, where the cost of a mistake is one row
 * you can retype; it is not enough for a term of coursework, a food diary and
 * a weight history that no export can bring back once it is gone. Typing the
 * word is a deliberate speed bump, and it is the only place in this app that
 * has one.
 *
 * The export buttons sit directly above this on purpose. The last thing
 * offered before leaving should be the copy you get to keep.
 */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim().toLowerCase() === 'delete';

  async function run() {
    setBusy(true);
    setError(null);
    const result = await deleteAccount();
    setBusy(false);
    // On success the session ends and the app returns to sign-in on its own;
    // there is deliberately no success message, because there is no longer an
    // account for one to be shown to.
    if (result.error) setError(result.error);
  }

  return (
    <section className="mb-12">
      <h2 className="type-h2 mb-3 px-4 text-text-hi">Delete this account</h2>
      <Card className="p-4">
        {!open ? (
          <>
            <p className="type-body mb-4 text-text-mid">
              Removes your account and everything in it — coursework, food, weight,
              settings. This cannot be undone, and an export taken afterwards is not
              possible.
            </p>
            <Button variant="quiet" onClick={() => setOpen(true)}>
              Delete account
            </Button>
          </>
        ) : (
          <>
            <p className="type-body mb-3 text-text-mid">
              Type <span className="tag type-caption">delete</span> to confirm.
            </p>
            <Field
              label="Confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="mt-3 type-note text-t-critical">
                {error} Your account was not deleted.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="quiet" disabled={!confirmed || busy} onClick={() => void run()}>
                {busy ? 'Deleting' : 'Delete everything'}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setOpen(false);
                  setTyped('');
                  setError(null);
                }}
              >
                Keep my account
              </Button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
