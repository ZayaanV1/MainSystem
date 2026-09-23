import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import {
  addFeed,
  loadFeeds,
  onFeedsChanged,
  previewFeed,
  refreshFeed,
  removeFeed,
  type CalendarFeed,
  type FeedPreview,
} from '../lib/feeds';
import { formatDay, formatTime, localDayKey } from '../lib/time';

/**
 * Calendars the app keeps in sync with.
 *
 * Google Calendar, Outlook, iCloud, a university timetable system — anything
 * that publishes an iCalendar address. Added once, then kept current: the
 * server re-reads every feed every five minutes, and the app asks again the
 * moment it is opened.
 *
 * WHY A PREVIEW BEFORE SUBSCRIBING
 *
 * Rule 6 — nothing is written that was not seen — applies to the decision to
 * subscribe even though it cannot apply to each event afterwards. So the
 * address is read first and the screen says what it found: the calendar's own
 * name, how many events are coming up, the next few of them, and anything it
 * could not read. "214 events" next to a wrong calendar's name is how you find
 * out you copied the work calendar instead of the personal one, before two
 * hundred rows exist rather than after.
 *
 * THE ADDRESS IS A SECRET, SO IT IS NEVER SHOWN AGAIN
 *
 * A Google secret address is a password to that calendar: anyone holding it
 * can read every event. Once saved, the screen shows only which service it
 * belongs to. Anyone looking over a shoulder at the settings screen learns
 * "calendar.google.com" and nothing they could use.
 */

interface CalendarFeedsProps {
  /** Called after anything that changes what the planner's views show. */
  onChanged: () => void;
}

export function CalendarFeeds({ onChanged }: CalendarFeedsProps) {
  const [feeds, setFeeds] = useState<CalendarFeed[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { feeds: rows, error } = await loadFeeds();
    setFailed(Boolean(error));
    setFeeds(error ? [] : rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A background sync updates the status lines as well as the calendar.
  useEffect(() => onFeedsChanged(() => void reload()), [reload]);

  // Relative times drift while the screen is open; re-render once a minute so
  // "updated just now" does not stay true for an hour.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  async function refresh(feed: CalendarFeed) {
    setBusy(feed.id);
    setNote(null);
    const r = await refreshFeed(feed.id);
    setBusy(null);
    if (!r.ok) setNote(r.reason ?? 'That didn’t work. Try again.');
    await reload();
    onChanged();
  }

  async function remove(feed: CalendarFeed) {
    setBusy(feed.id);
    setNote(null);
    const r = await removeFeed(feed.id);
    setBusy(null);
    setConfirmRemove(null);
    setNote(r.error ? 'Couldn’t remove that calendar. Try again.' : `${feed.label} removed, with its events.`);
    await reload();
    onChanged();
  }

  return (
    <section className="mb-8">
      <h2 className="type-h2 mb-1 px-4 text-text-hi">Your calendars</h2>
      <p className="type-note mb-3 px-4 text-text-low">
        Google Calendar, Outlook, iCloud or a university timetable, kept in sync. Changes appear
        within a few minutes, and straight away when you open the app.
      </p>

      {failed && (
        <p className="mb-3 px-4 type-note text-text-mid" role="alert">
          Couldn’t load your calendars.{' '}
          <button type="button" className="underline" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      )}

      {feeds && feeds.length > 0 && (
        <div className="mb-3 px-4">
          <Card>
            {feeds.map((feed) => (
              <div
                key={feed.id}
                className="flex flex-col gap-2 border-b border-ink-600 px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="type-body text-text-hi">{feed.label}</span>
                  <span className="type-caption text-text-low">{hostOf(feed.url)}</span>
                </div>

                <FeedStatus feed={feed} />

                {confirmRemove === feed.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-note text-text-mid">
                      Remove it and its {feed.event_total}{' '}
                      {feed.event_total === 1 ? 'event' : 'events'} from the planner?
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy === feed.id}
                      onClick={() => void remove(feed)}
                    >
                      Remove
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => setConfirmRemove(null)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy === feed.id}
                      onClick={() => void refresh(feed)}
                    >
                      {busy === feed.id ? 'Checking' : 'Refresh now'}
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => setConfirmRemove(feed.id)}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {note && (
        <p className="mb-3 px-4 type-note text-text-mid" role="status">
          {note}
        </p>
      )}

      <div className="px-4">
        {adding ? (
          <AddFeed
            onCancel={() => setAdding(false)}
            onAdded={async (label) => {
              setAdding(false);
              setNote(`${label} added. It stays in sync from now on.`);
              await reload();
              onChanged();
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {feeds && feeds.length > 0 ? 'Add another calendar' : 'Add a calendar'}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * One line saying whether this calendar is actually current.
 *
 * The status is the point of the list. A subscription that quietly stopped
 * working is indistinguishable from a quiet week unless something says so,
 * and a stale calendar is consulted with exactly the confidence a live one
 * earns.
 */
function FeedStatus({ feed }: { feed: CalendarFeed }) {
  const [showProblems, setShowProblems] = useState(false);
  const count = `${feed.event_total} ${feed.event_total === 1 ? 'event' : 'events'}`;

  return (
    <div className="flex flex-col gap-1">
      {feed.last_status === 'error' ? (
        <>
          <span className="type-note text-text-mid">
            Not updating
            {feed.last_synced_at ? ` since ${ago(feed.last_synced_at)}` : ''}. {feed.last_error}
          </span>
        </>
      ) : feed.last_synced_at ? (
        <span className="type-caption text-text-low">
          Updated {ago(feed.last_synced_at)} · {count}
        </span>
      ) : (
        <span className="type-note text-text-low">Waiting for the first sync.</span>
      )}

      {feed.last_problems.length > 0 && (
        <div>
          <button
            type="button"
            className="type-note text-text-mid underline"
            onClick={() => setShowProblems((v) => !v)}
            aria-expanded={showProblems}
          >
            {feed.last_problems.length === 1
              ? 'One thing couldn’t be read'
              : `${feed.last_problems.length} things couldn’t be read`}
          </button>
          {showProblems && (
            <ul className="mt-1 flex flex-col gap-1">
              {feed.last_problems.map((p) => (
                <li key={p} className="type-note text-text-low">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Subscribing: paste, check, confirm.
 *
 * The instructions for finding Google's address sit on the form itself rather
 * than behind a help link, because finding that address is the entire
 * difficulty of this feature. It is four clicks deep in Google's settings,
 * and the obvious links Google shows first are the wrong ones.
 */
function AddFeed({ onCancel, onAdded }: { onCancel: () => void; onAdded: (label: string) => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<Extract<FeedPreview, { ok: true }> | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    setPreview(null);
    const r = await previewFeed(url);
    setChecking(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setPreview(r);
    setLabel(r.name ?? '');
  }

  async function subscribe() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    const r = await addFeed(preview.url, label);
    setSaving(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    onAdded(label.trim() || preview.name || hostOf(preview.url));
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <Field
        label="Calendar address"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          // A changed address invalidates what was previewed.
          setPreview(null);
          setError(null);
        }}
        placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
      />

      <div className="flex flex-col gap-1">
        <span className="type-label text-text-mid">Finding it in Google Calendar</span>
        <ol className="flex list-decimal flex-col gap-1 pl-5 type-note text-text-low">
          <li>On a computer, open Google Calendar and go to Settings.</li>
          <li>Under “Settings for my calendars”, choose the calendar.</li>
          <li>Open “Integrate calendar”.</li>
          <li>Copy “Secret address in iCal format” — not the public address.</li>
        </ol>
        <span className="mt-1 type-note text-text-low">
          Outlook and iCloud call it a published or public calendar link; a university timetable
          usually offers one as “subscribe”.
        </span>
      </div>

      {error && (
        <p role="alert" className="type-note text-text-mid">
          {error}
        </p>
      )}

      {preview && (
        <div className="flex flex-col gap-3 rounded-card border border-ink-600 bg-ink-700 p-4">
          <span className="type-label text-text-hi">
            {preview.name ?? 'This calendar'} · {preview.count}{' '}
            {preview.count === 1 ? 'event' : 'events'} from last month to six months ahead
          </span>

          {preview.upcoming.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {preview.upcoming.map((e) => (
                <li key={`${e.uid}${e.startsAt}`} className="type-note text-text-mid">
                  {formatDay(localDayKey(new Date(e.startsAt)))}
                  {e.allDay ? '' : `, ${formatTime(new Date(e.startsAt))}`} — {e.title}
                </li>
              ))}
            </ul>
          ) : (
            <span className="type-note text-text-low">Nothing coming up in it yet.</span>
          )}

          {preview.problems.length > 0 && (
            <ul className="flex flex-col gap-1">
              {preview.problems.map((p) => (
                <li key={p} className="type-note text-text-low">
                  {p}
                </li>
              ))}
            </ul>
          )}

          <Field
            label="Call it"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={preview.name ?? 'Calendar'}
            hint="Shown next to its events, so you can tell calendars apart."
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {preview ? (
          <Button variant="primary" disabled={saving} onClick={() => void subscribe()}>
            {saving ? 'Adding' : 'Keep this in sync'}
          </Button>
        ) : (
          <Button variant="primary" disabled={!url.trim() || checking} onClick={() => void check()}>
            {checking ? 'Checking' : 'Check it'}
          </Button>
        )}
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/** Only the service, never the path. The path is the secret. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'calendar';
  }
}

/** "just now", "4 min ago", "2 h ago", or a date. */
function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDay(localDayKey(new Date(iso)));
}
