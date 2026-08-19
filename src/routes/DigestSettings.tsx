import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { useAuth } from '../lib/auth';
import {
  loadDigestSettings,
  saveDigestSettings,
  type DigestSettings as Fields,
} from '../lib/planner';
import { formatTime, todayKey, wallClockToUTC, zoneAbbrev } from '../lib/time';

/**
 * When the digest arrives, and how far ahead it looks.
 *
 * The schema and the scheduler have read these since Phase 0; they simply had
 * no way to be changed. The time is stored as local wall-clock and the
 * scheduler resolves it per day, so 07:00 stays 07:00 across both DST
 * transitions without anything here needing to know that.
 *
 * The windows are separate on purpose. Work needs a shorter horizon than
 * events: seven days of assignments is a plan, but seven days of notice for an
 * exam is not enough to do anything about it.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export function DigestSettings({ onSaved }: { onSaved?: () => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [fields, setFields] = useState<Fields | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadDigestSettings().then(setFields);
  }, []);

  if (!fields) return null;

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => (f ? { ...f, [key]: value } : f));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fields) return;

    setSaving(true);
    setMessage(null);
    const { error } = await saveDigestSettings(userId, fields);
    setSaving(false);

    setMessage(error ? `Couldn't save. ${error}` : 'Saved.');
    if (!error) onSaved?.();
  }

  // Shown back as a real instant so the effect of the setting is concrete
  // rather than two numbers in boxes.
  const preview = formatTime(
    wallClockToUTC(todayKey(), fields.digest_hour, fields.digest_minute),
  );

  return (
    <form onSubmit={submit}>
      <Card className="p-4">
        <div className="flex flex-col gap-6">
          <button
            type="button"
            onClick={() => set('digest_enabled', !fields.digest_enabled)}
            aria-pressed={fields.digest_enabled}
            className="flex items-center gap-3 text-left"
          >
            <span
              aria-hidden
              className={[
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
                fields.digest_enabled ? 'border-t-done bg-t-done' : 'border-ink-600',
              ].join(' ')}
            />
            <span className="type-label text-text-hi">Send a morning digest</span>
          </button>

          {fields.digest_enabled && (
            <>
              <Field
                label="Time"
                type="time"
                value={`${pad(fields.digest_hour)}:${pad(fields.digest_minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) {
                    setFields((f) => (f ? { ...f, digest_hour: h, digest_minute: m } : f));
                  }
                }}
                hint={`Arrives at ${preview} ${zoneAbbrev()}, all year.`}
              />

              <Field
                label="Look ahead for work"
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                value={fields.assignment_window_days}
                onChange={(e) => set('assignment_window_days', Number(e.target.value) || 1)}
                hint="Days. Overdue work is always included, however old."
              />

              <Field
                label="Look ahead for events"
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                value={fields.event_window_days}
                onChange={(e) => set('event_window_days', Number(e.target.value) || 1)}
                hint="Usually longer. A week's notice for an exam is not enough to act on."
              />
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
          {/*
            A second recurring message, off unless asked for. It rides the
            digest's send time rather than adding another pair of boxes: two
            configurable times for two notifications is more setup than the
            feature is worth.
          */}
          <div className="flex flex-col gap-3 border-t border-ink-600 pt-6">
            <button
              type="button"
              onClick={() => set('weekly_review_enabled', !fields.weekly_review_enabled)}
              aria-pressed={fields.weekly_review_enabled}
              className="flex items-center gap-3 text-left"
            >
              <span
                aria-hidden
                className={[
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
                  fields.weekly_review_enabled ? 'border-t-done bg-t-done' : 'border-ink-600',
                ].join(' ')}
              />
              <span className="type-label text-text-hi">Weekly review</span>
            </button>
            <p className="type-note text-text-low">
              What you finished, what is due next, and anything that has been sitting. Sent at the
              same time as the digest.
            </p>

            {fields.weekly_review_enabled && (
              <div className="flex flex-wrap gap-2">
                {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => (
                  <Chip
                    key={d}
                    selected={fields.weekly_review_weekday === d}
                    onClick={() => set('weekly_review_weekday', d)}
                  >
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]}
                  </Chip>
                ))}
              </div>
            )}
          </div>

            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving' : 'Save'}
            </Button>
            {message && <span className="type-caption text-text-mid">{message}</span>}
          </div>
        </div>
      </Card>
    </form>
  );
}
