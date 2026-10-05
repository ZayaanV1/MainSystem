import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EASE } from '../lib/motion';
import { aboodSummary, appearanceSummary, notificationsSummary } from '../lib/settingsSummary';
import {
  bridgeStatus,
  forgetFact,
  imessageLink,
  issueBridgeKey,
  loadCheckins,
  saveCheckins,
  type CheckinSettings,
  loadMemory,
  telegramLink,
  telegramLinked,
  unlinkHandle,
  type BridgeStatus,
  type MemoryFact,
} from '../lib/abood';
import { SectionHead } from '../components/SectionHead';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { hasOwnGroqKey, loadDigestSettings, setOwnGroqKey, type DigestSettings as DigestSettingsRow } from '../lib/planner';
import { applyTheme, readTheme, writeTheme, type ThemeChoice } from '../lib/theme';
import { setAppearance, useAppearance, type GlassLevel, type MotionLevel, type SlipStyle } from '../lib/appearance';
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
import {
  activeTimezone,
  detectedTimezone,
  formatDay,
  formatTime,
  localDayKey,
  zoneAbbrev,
} from '../lib/time';
import { saveTimezone } from '../lib/planner';

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

export function Settings() {
  const { signOut, session } = useAuth();
  const userId = session?.user.id ?? '';

  const [log, setLog] = useState<DeliveryRow[]>([]);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sw, setSw] = useState<SwState>({ status: 'registering' });

  useEffect(() => subscribeSw(setSw), []);

  /*
   * Which page is open, and the slide between pages: forward comes in from
   * the right, Back from the left (rule 12), and each page opens at its top.
   */
  const [page, setPage] = useState<PageId | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const direction = useRef<1 | -1>(1);
  const go = (next: PageId | null) => {
    direction.current = next ? 1 : -1;
    setPage(next);
  };
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const el = stage.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [
        { opacity: 0, transform: `translateX(${direction.current * 28}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 320, easing: EASE.glide },
    );
  }, [page]);

  // What each row says it is set to.
  const appearance = useAppearance();
  const [digest, setDigest] = useState<DigestSettingsRow | null>(null);
  const [keys, setKeys] = useState<{ groq: boolean; gemini: boolean } | null>(null);
  const [telegram, setTelegram] = useState<boolean | null>(null);
  const [checkins, setCheckins] = useState<CheckinSettings | null>(null);
  useEffect(() => {
    if (page !== null) return;
    void loadDigestSettings().then(setDigest);
    void Promise.all([hasOwnGroqKey(), hasOwnApiKey()]).then(([groq, gemini]) => setKeys({ groq, gemini }));
    void telegramLinked().then(setTelegram);
    void loadCheckins().then(setCheckins);
  }, [page]);
  const summary = {
    notifications: notificationsSummary(push, digest),
    appearance: appearanceSummary(readTheme(), appearance),
    abood: aboodSummary(keys, telegram, checkins),
  };

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

  /*
   * One short page of grouped rows, each saying what it is set to and opening
   * into its own page (the UI overview). The same fourteen sections, none
   * removed (rule 13): they were one 5,600 px page in the order they were
   * built, with the AI keys between the delivery log and iMessage.
   */
  const pages: Record<PageId, { title: string; body: ReactNode }> = {
    notifications: {
      title: 'Notifications',
      body: (
        <>
          <section className="mb-8">
            <SectionHead title="This device" />
            <Card className="p-4">
              <p className="type-body text-text-mid">{push ? PUSH_COPY[push] : 'Checking.'}</p>

              {/* The registration result, stated outright. This failed
                  silently for two days: no registration, no error, and a
                  status line confidently reporting success. */}
              {sw.status === 'failed' && (
                <p className="mt-2 type-note text-t-overdue">Service worker did not register: {sw.error}</p>
              )}
              {sw.status === 'unsupported' && (
                <p className="mt-2 max-w-prose type-note text-text-low">This browser has no service worker support.</p>
              )}

              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="primary" onClick={sendTest} disabled={testing}>
                  {testing ? 'Sending' : 'Send test notification'}
                </Button>

                {/* Offered for every state a tap can actually fix. Hiding it
                    when the browser claimed success is what let a
                    half-registered device sit there looking fine. */}
                {(push === 'needs-permission' || push === 'device-only' || push === 'no-service-worker') && (
                  <Button onClick={enablePush}>{push === 'device-only' ? 'Register this device' : 'Enable push here'}</Button>
                )}
              </div>

              {message && <p className="type-caption mt-4 text-text-mid">{message}</p>}
            </Card>
          </section>

          <section className="mb-8">
            <SectionHead title="Morning digest" />
            <DigestSettings />
          </section>

          <section className="mb-8">
            <SectionHead title="Delivery log" />
            {log.length === 0 ? (
              <EmptyState>No delivery attempts recorded yet.</EmptyState>
            ) : (
              <Card>
                {log.map((row) => (
                  <div key={row.id} className="flex items-baseline gap-3 border-b border-ink-600 px-4 py-3 last:border-b-0">
                    <span
                      aria-hidden
                      className={[
                        'h-2 w-2 shrink-0 rounded-pill',
                        row.status === 'sent' ? 'bg-t-done' : row.status === 'failed' ? 'bg-t-overdue' : 'bg-text-low',
                      ].join(' ')}
                    />
                    <div className="flex-1">
                      {/* Status is written as well as coloured — colour is
                          never the only signal, including here. */}
                      <div className="type-label text-text-hi">
                        {row.status} &middot; {row.kind}
                        {row.channel ? ` · ${row.channel}` : ''}
                      </div>
                      {row.error && <div className="type-caption text-text-mid">{row.error}</div>}
                    </div>
                    <span className="type-caption shrink-0 text-text-low">
                      {formatDay(localDayKey(new Date(row.created_at)))} {formatTime(new Date(row.created_at))}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      ),
    },
    timezone: { title: 'Time zone', body: <TimeZone userId={userId} bare /> },
    appearance: { title: 'Appearance', body: <Appearance bare /> },
    calendar: { title: 'Calendar feed', body: <CalendarFeed bare /> },
    abood: {
      title: 'Abood',
      body: (
        <>
          <GroqKey userId={userId} />
          <ApiKey userId={userId} />
          <TextAbood userId={userId} />
          <IMessageAbood userId={userId} />
          <AboodTextsFirst userId={userId} />
          <AboodMemory />
        </>
      ),
    },
    data: {
      title: 'Your data',
      body: (
        <>
          <section className="mb-8">
            <SectionHead title="Export" />
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
        </>
      ),
    },
  };

  const email = session?.user.email ?? '';
  const open = page ? pages[page] : null;

  return (
    <main className="page-frame">
      <div ref={stage} key={page ?? 'root'}>
        {open ? (
          <>
            <button type="button" className="settings-back" onClick={() => go(null)}>
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
              Settings
            </button>
            <h1 className="page-title mb-6 px-4">{open.title}</h1>
            {open.body}
          </>
        ) : (
          <>
            <h1 className="page-title mb-6 px-4">Settings</h1>

            <div className="mat settings-account mb-6">
              <span aria-hidden className="settings-avatar">
                {(email[0] ?? '?').toUpperCase()}
              </span>
              <span className="min-w-0">
                <b className="block truncate">{email || 'Signed in'}</b>
                <span className="type-note text-text-low">Signed in · build {__BUILD_ID__}</span>
              </span>
            </div>

            <div className="flex flex-col gap-4">
              <div className="mat settings-rows">
                <SettingsRow icon="bell" tone="ember" label="Notifications and digest" value={summary.notifications} onOpen={() => go('notifications')} />
                <SettingsRow icon="globe" label="Time zone" value={`${activeTimezone().replace(/_/g, ' ')} (${zoneAbbrev()})`} onOpen={() => go('timezone')} />
              </div>

              <div className="mat settings-rows">
                <SettingsRow icon="sun" tone="ink" label="Appearance" value={summary.appearance} onOpen={() => go('appearance')} />
                <SettingsRow icon="calendar" label="Calendar feed" value="Your deadlines in any calendar app" onOpen={() => go('calendar')} />
              </div>

              <div className="mat settings-rows">
                <SettingsRow icon="chat" label="Abood" value={summary.abood} onOpen={() => go('abood')} />
              </div>

              <div className="mat settings-rows">
                <SettingsRow icon="box" tone="ink" label="Your data" value="Export JSON or CSV · delete the account" onOpen={() => go('data')} />
                <SettingsRow icon="out" tone="ink" label="Sign out" value={email || null} onOpen={() => void signOut()} chevron={false} />
              </div>
            </div>

            {/* Which build this device is running. An installed app can keep
                an old version until it is closed and reopened, and without
                this there was no way to tell from the phone whether a deploy
                had arrived. */}
            <p className="type-note mt-8 mb-12 px-4 text-text-low">
              Build {__BUILD_ID__} · {__BUILD_TIME__}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

type PageId = 'notifications' | 'timezone' | 'appearance' | 'calendar' | 'abood' | 'data';

const GLYPHS: Record<string, string> = {
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  calendar: 'M3.5 10h17M8 3v4M16 3v4M6.5 5h11a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12',
  box: 'M21 8v12H3V8M1 3h22v5H1zM10 12h4',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

/**
 * One Settings row: what it is, what it is set to, and where it goes. The
 * value line is the point: most visits to Settings are to check something,
 * and a row that says its value answers that without opening anything.
 */
function SettingsRow({
  icon,
  tone = 'phthalo',
  label,
  value,
  onOpen,
  chevron = true,
}: {
  icon: keyof typeof GLYPHS;
  tone?: 'ember' | 'ink' | 'phthalo';
  label: string;
  value: string | null;
  onOpen: () => void;
  chevron?: boolean;
}) {
  return (
    <button type="button" className="settings-row" onClick={onOpen}>
      <span aria-hidden className="settings-ico" data-tone={tone}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={GLYPHS[icon]} />
        </svg>
      </span>
      <span className="settings-row-label">
        <b>{label}</b>
        {/* Reserved even while loading, so rows do not grow when values land. */}
        <span>{value ?? '\u00a0'}</span>
      </span>
      {chevron && (
        <svg aria-hidden className="settings-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="m9 6 6 6-6 6" />
        </svg>
      )}
    </button>
  );
}

/**
 * The account's time zone.
 *
 * Every "today", every due label and the digest's send time are computed in
 * it. It was set once, from whichever device opened the app first, and no
 * screen could change it — so a student who moved for university kept the
 * old zone, and every deadline computed from it, for good.
 *
 * Saving reloads the app, because every date on screen and in the outbox's
 * optimistic layer was computed in the old zone; recomputing them one by one
 * is how one gets missed.
 */
function TimeZone({ userId, bare = false }: { userId: string; bare?: boolean }) {
  const current = activeTimezone();
  const device = detectedTimezone();
  const [choice, setChoice] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const zones = (() => {
    try {
      const all = (Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
      if (all?.length) return all.includes(current) ? all : [current, ...all];
    } catch {
      // Older engines: offer the two zones that matter rather than nothing.
    }
    return [...new Set([current, device])];
  })();

  async function save(zone: string) {
    setBusy(true);
    setMessage(null);
    const { error } = await saveTimezone(userId, zone);
    if (error) {
      setBusy(false);
      setMessage(`Not saved. ${error}`);
      return;
    }
    window.location.reload();
  }

  return (
    <section className="mb-8">
      {!bare && <SectionHead title="Time zone" />}
      <Card className="flex flex-col gap-4 p-4">
        <p className="type-body text-text-mid">
          Days, deadlines and the morning digest use {current.replace(/_/g, ' ')} ({zoneAbbrev()}).
        </p>

        {device !== current && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="type-note text-text-low">This device is set to {device.replace(/_/g, ' ')}.</p>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save(device)}>
              Use {device.replace(/_/g, ' ')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="zone" className="kicker">
              Or choose
            </label>
            <select
              id="zone"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="well w-auto max-w-full px-3 type-body"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <Button variant="quiet" disabled={busy || choice === current} onClick={() => void save(choice)}>
            {busy ? 'Saving' : 'Save'}
          </Button>
        </div>

        <p className="type-note text-text-low">
          Travelling does not change this on its own, so what is due stays put. Change it when you move.
        </p>
        {message && <p role="alert" className="type-note text-text-mid">{message}</p>}
      </Card>
    </section>
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
function CalendarFeed({ bare = false }: { bare?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reveal(rotate = false) {
    setBusy(true);
    setCopied(false);
    const next = await calendarFeedUrl(rotate);
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
      {!bare && <SectionHead title="Calendar feed" />}
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
              className="well type-quote text-text-mid"
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
 * Without one, the syllabus reader, task breakdowns and Abood draw on a single
 * shared free tier, which means one heavy account can exhaust it for everyone
 * else. Your own
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
    // Checked before it is stored: a Groq key saved here overrode the shared
    // Gemini key and broke the syllabus reader, the breakdowns and the briefing
    // with "API key not valid", with nothing on screen to say why.
    if (next?.trim().startsWith('gsk_')) {
      setMessage('That is a Groq key. Paste it under Abood’s model below; this field takes a Google Gemini key, which starts with AIza.');
      setBusy(false);
      return;
    }
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
      <SectionHead title="Your own AI key" />
      <p className="type-note mb-3 max-w-prose px-4 text-text-low">
        The syllabus reader and Abood share one free allowance across everyone using this app. Add your
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
              className="well type-body text-text-hi placeholder:text-text-low"
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
function Appearance({ bare = false }: { bare?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme());

  // Keeps this control honest if the theme is changed from somewhere else in
  // the same session — the system listener in main.tsx, for one.
  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  // Rule 13: the slip that was replaced stays a choice.
  const look = useAppearance();
  const slipOptions: { value: SlipStyle; label: string; hint: string }[] = [
    { value: 'ticket', label: 'Ticket', hint: 'The countdown in a stub; the ring finishes it and punches the stub.' },
    { value: 'glass', label: 'Glass', hint: 'The countdown on the right, a ring to tick.' },
  ];

  const glassOptions: { value: GlassLevel; label: string; hint: string }[] = [
    { value: 'off', label: 'Off', hint: 'Solid bars and menus. Lightest on the battery.' },
    { value: 'bars', label: 'Bars', hint: 'The tab bar, menus and the dimming behind sheets are glass.' },
    { value: 'surfaces', label: 'Everywhere', hint: 'Every card is glass too. The heaviest on the graphics chip.' },
  ];
  const motionOptions: { value: MotionLevel; label: string; hint: string }[] = [
    { value: 'full', label: 'Full', hint: 'Every moment as designed: the falling punch, the stretching tab, the page that steps back.' },
    { value: 'calm', label: 'Calm', hint: 'Everything still animates, without the flourishes.' },
  ];

  const options: { value: ThemeChoice; label: string; hint: string }[] = [
    { value: 'system', label: 'System', hint: 'Follows your device' },
    { value: 'light', label: 'Light', hint: 'Always light' },
    { value: 'dark', label: 'Dark', hint: 'Always dark' },
  ];

  return (
    <section className="mb-8">
      {!bare && <SectionHead title="Appearance" />}
      <Card className="p-4">
        <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Chip
              key={o.value}
              role="radio"
              aria-checked={choice === o.value}
              selected={choice === o.value}
              onClick={() => {
                setChoice(o.value);
                writeTheme(o.value);
              }}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="type-note mt-3 text-text-low">
          {options.find((o) => o.value === choice)?.hint}. This is remembered on
          this device only.
        </p>

        <p className="kicker mt-6 mb-2">Work slips</p>
        <div role="radiogroup" aria-label="Work slips" className="flex flex-wrap gap-2">
          {slipOptions.map((o) => (
            <Chip
              key={o.value}
              role="radio"
              aria-checked={look.slip === o.value}
              selected={look.slip === o.value}
              onClick={() => setAppearance({ slip: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="type-note mt-3 text-text-low">{slipOptions.find((o) => o.value === look.slip)?.hint}</p>

        <p className="kicker mt-6 mb-2">Glass</p>
        <div role="radiogroup" aria-label="Glass" className="flex flex-wrap gap-2">
          {glassOptions.map((o) => (
            <Chip
              key={o.value}
              role="radio"
              aria-checked={look.glass === o.value}
              selected={look.glass === o.value}
              onClick={() => setAppearance({ glass: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="type-note mt-3 text-text-low">{glassOptions.find((o) => o.value === look.glass)?.hint}</p>

        <label className="mt-4 flex min-h-[var(--tap)] items-center justify-between gap-4">
          <span className="type-label text-text-hi">Blur that comes into focus</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={look.animatedBlur}
            disabled={look.glass === 'off'}
            onChange={(e) => setAppearance({ animatedBlur: e.target.checked })}
          />
        </label>
        <p className="type-note text-text-low">
          Glass behind sheets and menus sharpens as they open. The most demanding option; best on a recent phone.
        </p>

        <p className="kicker mt-6 mb-2">Motion</p>
        <div role="radiogroup" aria-label="Motion" className="flex flex-wrap gap-2">
          {motionOptions.map((o) => (
            <Chip
              key={o.value}
              role="radio"
              aria-checked={look.motion === o.value}
              selected={look.motion === o.value}
              onClick={() => setAppearance({ motion: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="type-note mt-3 text-text-low">{motionOptions.find((o) => o.value === look.motion)?.hint}</p>
        <p className="type-note mt-2 text-text-low">These are remembered on this device only.</p>
      </Card>
    </section>
  );
}

/**
 * Leaving for good.
 *
 * Typed confirmation rather than a second button. "Delete" then "Delete for
 * good" is right for one assignment, where the cost of a mistake is one row
 * you can retype; it is not enough for a term of coursework and grades that no
 * export can bring back once it is gone. Typing the
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
      <SectionHead title="Delete this account" />
      <Card className="p-4">
        {!open ? (
          <>
            <p className="type-body mb-4 text-text-mid">
              Removes your account and everything in it — coursework, calendars, checklist,
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

/**
 * A Groq key for the chatbot.
 *
 * Deliberately its own section rather than a second field inside the Gemini
 * one, because they do different jobs and saying so prevents the obvious wrong
 * assumption. Groq's chat models take no documents, so the syllabus reader
 * stays on Gemini no matter what is set here — and a single "AI key" field
 * would imply otherwise and quietly break PDF import.
 *
 * Write-only, like the other. The app asks whether a key is set and never
 * reads one back.
 */
function GroqKey({ userId }: { userId: string }) {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void hasOwnGroqKey().then(setIsSet);
  }, []);

  async function save(next: string | null) {
    setBusy(true);
    setMessage(null);
    if (next?.trim().startsWith('AIza')) {
      setMessage('That is a Google Gemini key. Paste it under Your own AI key above; this field takes a Groq key, which starts with gsk_.');
      setBusy(false);
      return;
    }
    const { error } = await setOwnGroqKey(userId, next);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setDraft('');
    setIsSet(Boolean(next));
    setMessage(next ? 'Saved. Abood will use it from the next question.' : 'Removed.');
  }

  return (
    <section className="mb-8">
      <SectionHead title="Abood’s model" />
      <Card className="p-4">
        <p className="type-body mb-3 text-text-mid">
          A Groq key runs the chatbot on your own account, so the shared daily
          question limit stops applying to you. Free keys are available at
          console.groq.com.
        </p>
        <p className="type-note mb-4 text-text-low">
          Syllabus PDFs keep using Gemini either way — Groq&rsquo;s chat models
          don&rsquo;t accept documents.
        </p>

        <Field
          label={isSet ? 'Replace the key' : 'Groq API key'}
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isSet ? 'A key is set' : 'gsk_…'}
          hint="Stored write-only. The app never shows it back."
        />

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={!draft.trim() || busy}
            onClick={() => void save(draft)}
          >
            {busy ? 'Saving' : 'Save'}
          </Button>
          {isSet && (
            <Button variant="quiet" disabled={busy} onClick={() => void save(null)}>
              Remove
            </Button>
          )}
        </div>

        {message && <p className="mt-3 type-note text-text-mid">{message}</p>}
      </Card>
    </section>
  );
}

/**
 * Abood by text message.
 *
 * The morning digest already arrives on Telegram; this makes the same chat a
 * conversation. Linking is a one-time code carried in the bot's start link,
 * so the account that tapped Connect is the only one a chat can join.
 */
function TextAbood({ userId }: { userId: string }) {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void telegramLinked().then(setLinked);
  }, []);

  async function connect() {
    setBusy(true);
    setMessage(null);
    const r = await telegramLink(userId);
    setBusy(false);
    if ('error' in r) setMessage(r.error);
    else setUrl(r.url);
  }

  return (
    <section className="mb-8">
      <SectionHead title="Text Abood" />
      <Card className="p-4">
        <p className="type-body mb-3 text-text-mid">
          Ask about your week from Telegram, the same way you would here. It is
          the same conversation and the same memory, and anything it offers to
          change still waits for you to confirm it in the app.
        </p>
        <p className="type-note mb-4 text-text-low">
          {linked === null
            ? 'Checking.'
            : linked
              ? 'Your Telegram is connected. Message the bot any time; send /help for commands.'
              : 'Not connected yet.'}
        </p>

        {url ? (
          <div className="flex flex-wrap items-center gap-3">
            <a href={url} target="_blank" rel="noreferrer noopener" className="btn btn-primary px-5 type-label">
              Open Telegram
            </a>
            <span className="type-note text-text-low">Then tap Start. The link works once, for fifteen minutes.</span>
          </div>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Making a link' : linked ? 'Connect a different chat' : 'Connect Telegram'}
          </Button>
        )}

        {message && <p className="mt-3 type-note text-text-mid">{message}</p>}
      </Card>
    </section>
  );
}

/**
 * What Abood has picked up about you.
 *
 * Facts are learned from what you say to it and announced when they are
 * learned; this is where they can be read in full and taken back. A memory
 * that could not be inspected or corrected would be the app keeping notes on
 * you, which is not the same thing as remembering.
 */
function AboodMemory() {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    void loadMemory().then((r) => {
      setFacts(r.facts);
      setFailed(r.failed);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section className="mb-8">
      <SectionHead title="What Abood remembers" count={facts?.length || null} />
      {failed ? (
        <p className="px-4 type-note text-text-mid">Couldn&rsquo;t load this. Nothing has been lost.</p>
      ) : facts === null ? null : facts.length === 0 ? (
        <EmptyState>
          Nothing yet. Abood picks up routines and preferences as you talk, and tells you when it does.
        </EmptyState>
      ) : (
        <Card>
          {facts.map((f) => (
            <div key={f.id} className="mat-row flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="type-body text-text-hi">{f.fact}</span>
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Forget: ${f.fact}`}
                onClick={() => void forgetFact(f.id).then(reload)}
              >
                Forget
              </Button>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

/**
 * Abood by iMessage, through a Mac this account runs.
 *
 * Each account has its own bridge now. It used to be one global row every
 * account could read, so a new account saw the owner's Apple ID address and a
 * Connect button that would have linked their phone to the owner's Mac.
 *
 * Says plainly whether the Mac is up, because a bridge that is off looks
 * exactly like an Abood that is ignoring you.
 */
function IMessageAbood({ userId }: { userId: string }) {
  const [status, setStatus] = useState<BridgeStatus | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => void bridgeStatus().then(setStatus), []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function connect() {
    if (!status?.address) return;
    setMessage(null);
    const r = await imessageLink(userId, status.address);
    if ('error' in r) setMessage(r.error);
    else setUrl(r.url);
  }

  async function makeKey() {
    setMessage(null);
    setReplacing(false);
    const r = await issueBridgeKey();
    if ('error' in r) setMessage(r.error);
    else {
      setKey(r.key);
      reload();
    }
  }

  const command = key ? `bridge/imessage/install.sh <apple-id-abood-answers-on> ${key}` : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mb-8">
      <SectionHead title="iMessage" />
      <Card className="p-4">
        <p className="type-body mb-3 text-text-mid">
          The same Abood in Messages, answered by a Mac you run with the planner&rsquo;s bridge on it.
        </p>
        <p className="type-note mb-4 text-text-low">
          {status === undefined
            ? 'Checking.'
            : status === null
              ? 'Couldn’t check the bridge.'
              : !status.exists
                ? 'No bridge yet. Make a key, then run the installer on the Mac that should answer.'
                : !status.lastSeen
                  ? 'Your bridge has a key, but no Mac has checked in with it yet.'
                  : status.online
                    ? `Your bridge is up${status.address ? `, answering on ${status.address}` : ''}.`
                    : 'Your bridge Mac is offline or asleep, so messages wait until it is back.'}
        </p>

        {key && (
          <div className="mb-4 flex flex-col gap-2">
            <span className="kicker">Run this on the bridge Mac</span>
            <input
              readOnly
              value={command}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Installer command"
              className="well type-quote text-text-mid"
            />
            <p className="type-note text-t-approaching">
              This key is shown once. Anyone with it can answer as your Abood, so keep it on that Mac.
            </p>
            <div>
              <Button variant="quiet" size="sm" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        {status && status.handles.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            <span className="kicker">Linked</span>
            {status.handles.map((h) => (
              <div key={h} className="flex items-center justify-between gap-3">
                <span className="type-body text-text-hi">{h}</span>
                <Button variant="quiet" size="sm" onClick={() => void unlinkHandle(h).then(reload)}>
                  Unlink
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {status?.address &&
            (url ? (
              <>
                <a href={url} className="btn btn-primary px-5 type-label">
                  Open Messages
                </a>
                <span className="type-note text-text-low">Send the message it writes for you, from the phone you want linked.</span>
              </>
            ) : (
              <Button variant="secondary" onClick={() => void connect()}>
                Connect this phone
              </Button>
            ))}

          {status && !status.exists && !key && (
            <Button variant="secondary" onClick={() => void makeKey()}>
              Make a bridge key
            </Button>
          )}

          {status?.exists && !key &&
            (replacing ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => void makeKey()}>
                  Replace it
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setReplacing(false)}>
                  Keep the current key
                </Button>
                <span className="type-note text-text-low">The Mac using the old key stops answering until it is reinstalled.</span>
              </>
            ) : (
              <Button variant="quiet" size="sm" onClick={() => setReplacing(true)}>
                New bridge key
              </Button>
            ))}
        </div>

        {message && <p className="mt-3 type-note text-text-mid">{message}</p>}
      </Card>
    </section>
  );
}

const hourLabel = (h: number) => (h === 0 || h === 24 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`);

/**
 * When Abood texts first. "When I've gone quiet" is one check-in per silence;
 * a rhythm is every N hours inside a window, and stops after two in a row go
 * unanswered so it never texts into a void.
 */
function AboodTextsFirst({ userId }: { userId: string }) {
  const [s, setS] = useState<CheckinSettings | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void loadCheckins().then(setS);
  }, []);

  async function change(next: CheckinSettings) {
    setS(next);
    setNote(null);
    const ok = await saveCheckins(userId, next);
    setNote(ok ? 'Saved.' : 'Couldn’t save that. Try again.');
  }

  if (s === undefined) return null;

  return (
    <section className="mb-8">
      <SectionHead title="Abood texts first" />
      <Card className="p-4">
        {s === null ? (
          <p className="type-note text-text-mid">Couldn&rsquo;t load this setting.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="type-body text-text-mid">
              Abood checks in by iMessage or Telegram, about something real — never to guilt you.
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When Abood texts first">
              <Chip selected={!s.on} onClick={() => void change({ ...s, on: false })}>Off</Chip>
              <Chip selected={s.on && s.every === null} onClick={() => void change({ ...s, on: true, every: null })}>
                When I&rsquo;ve gone quiet
              </Chip>
              {[2, 3, 4, 6].map((h) => (
                <Chip key={h} selected={s.on && s.every === h} onClick={() => void change({ ...s, on: true, every: h })}>
                  Every {h} hours
                </Chip>
              ))}
            </div>
            {s.on && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="kicker" htmlFor="checkin-from">Between</label>
                <select
                  id="checkin-from"
                  className="well w-auto px-3 type-body"
                  value={s.from}
                  onChange={(e) => void change({ ...s, from: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{hourLabel(h)}</option>
                  ))}
                </select>
                <label className="kicker" htmlFor="checkin-until">and</label>
                <select
                  id="checkin-until"
                  className="well w-auto px-3 type-body"
                  value={s.until}
                  onChange={(e) => void change({ ...s, until: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>{hourLabel(h)}</option>
                  ))}
                </select>
              </div>
            )}
            {note && <p className="type-note text-text-mid">{note}</p>}
          </div>
        )}
      </Card>
    </section>
  );
}
