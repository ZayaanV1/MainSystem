import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import { createSeries, type Course, type SeriesFields } from '../lib/planner';
import { seriesDays, describeSeries, MAX_INSTANCES } from '../../supabase/functions/_shared/series';
import { todayKey, formatDay } from '../lib/time';

/**
 * Setting up a weekly lab.
 *
 * The friction this removes is the largest in the app: a weekly lab was twelve
 * rows typed twelve times, and a Tuesday tutorial over a term was thirteen —
 * the most predictable data a student has was the most laborious to enter.
 *
 * THE PREVIEW IS THE FEATURE
 *
 * Every recurrence UI ever built gets distrusted for the same reason: you
 * configure a pattern, press save, and find out what it meant afterwards. So
 * this shows the actual dates, all of them, before anything is written —
 * derived from the same pure function that will do the generating, not from a
 * second implementation that can disagree with it.
 *
 * That also makes the count honest. "This will add 12 pieces of work" is the
 * number of rows about to appear, and rule 6 says nothing is written until it
 * is confirmed.
 */

const WEEKDAYS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

interface RepeatingWorkProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  courses: Course[];
  onCreated: () => void;
}

export function RepeatingWork({ open, onClose, userId, courses, onCreated }: RepeatingWorkProps) {
  const [fields, setFields] = useState<SeriesFields>(() => ({
    title: '',
    course_id: null,
    recurrence: 'weekdays',
    weekdays: [],
    interval_days: 7,
    anchor_day: todayKey(),
    // A term, roughly. Chosen rather than left blank because until_day is
    // required — an unbounded series would silently stop at the generator's
    // horizon and look like a bug.
    until_day: addMonths(todayKey(), 4),
    due_time: null,
    effort_minutes: null,
    weight_percent: null,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SeriesFields>(key: K, value: SeriesFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  // The same function the generator uses. A separate preview implementation is
  // how a preview ends up lying.
  const days = useMemo(
    () =>
      seriesDays({
        id: 'preview',
        active: true,
        ...fields,
        weekdays: fields.weekdays,
      }),
    [fields],
  );

  const ready = fields.title.trim().length > 0 && days.length > 0;

  /*
   * The generator stops at MAX_INSTANCES, so a pattern that would run past it
   * comes back truncated — and the preview would then show a last date that is
   * not the end date asked for, silently. The preview's entire justification
   * is that you can check it before anything is written, which a preview that
   * quietly misreports its own range does not survive.
   */
  const truncated = days.length >= MAX_INSTANCES;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await createSeries(userId, fields);
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Repeating work">
      <div className="flex flex-col gap-4">
        <Field
          label="What is it"
          value={fields.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Assembly lab"
          hint="Each one gets this name and its own date."
        />

        <label className="flex flex-col gap-1">
          <span className="type-label text-text-mid">Course</span>
          <select
            value={fields.course_id ?? ''}
            onChange={(e) => set('course_id', e.target.value || null)}
            className="min-h-[var(--tap)] rounded-card border border-ink-600 bg-ink-800 px-3 type-body text-text-hi"
          >
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          <span className="type-label text-text-mid">How often</span>
          <div className="flex gap-2">
            {(['weekdays', 'interval'] as const).map((r) => (
              <Button
                key={r}
                variant={fields.recurrence === r ? 'primary' : 'quiet'}
                size="sm"
                onClick={() => set('recurrence', r)}
              >
                {r === 'weekdays' ? 'On certain days' : 'Every N days'}
              </Button>
            ))}
          </div>
        </div>

        {fields.recurrence === 'weekdays' ? (
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const on = fields.weekdays.includes(d.iso);
              return (
                <Button
                  key={d.iso}
                  variant={on ? 'primary' : 'quiet'}
                  size="sm"
                  aria-pressed={on}
                  onClick={() =>
                    set(
                      'weekdays',
                      on
                        ? fields.weekdays.filter((w) => w !== d.iso)
                        : [...fields.weekdays, d.iso],
                    )
                  }
                >
                  {d.label}
                </Button>
              );
            })}
          </div>
        ) : (
          <Field
            label="Every how many days"
            type="number"
            inputMode="numeric"
            min={1}
            value={fields.interval_days ?? ''}
            onChange={(e) => set('interval_days', Number(e.target.value) || null)}
            hint="14 for a biweekly lab."
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="First one"
            type="date"
            value={fields.anchor_day}
            onChange={(e) => set('anchor_day', e.target.value)}
          />
          <Field
            label="Until"
            type="date"
            value={fields.until_day}
            onChange={(e) => set('until_day', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Due time"
            type="time"
            value={fields.due_time ?? ''}
            onChange={(e) => set('due_time', e.target.value || null)}
            hint="Optional."
          />
          <Field
            label="Each worth"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.5"
            value={fields.weight_percent ?? ''}
            onChange={(e) => set('weight_percent', Number(e.target.value) || null)}
            hint="% of the grade"
          />
        </div>

        {/*
          The preview. Every date, before anything is written — rule 6 applies
          to a pattern exactly as it does to parsed food or an extracted
          syllabus, and a recurrence you cannot check is one you will not trust
          enough to rely on.
        */}
        <Card className="p-4">
          {days.length === 0 ? (
            <p className="type-note text-text-mid">
              {fields.recurrence === 'weekdays' && fields.weekdays.length === 0
                ? 'Pick at least one day.'
                : 'Nothing falls in that range yet.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="type-label text-text-hi">
                {describeSeries({ id: 'p', active: true, ...fields })} &middot;{' '}
                {days.length} {days.length === 1 ? 'piece of work' : 'pieces of work'}
              </span>
              <span className="type-note text-text-mid">
                {formatDay(days[0])}
                {days.length > 1 && ` to ${formatDay(days[days.length - 1])}`}
              </span>
              {truncated && (
                <span className="type-note text-t-urgent">
                  That is the most this can make at once, so it stops short of{' '}
                  {formatDay(fields.until_day)}. Narrow the pattern or bring the
                  end date in — or add the rest later from the list of patterns.
                </span>
              )}
              <div className="flex flex-wrap gap-1">
                {days.slice(0, 12).map((d) => (
                  <span key={d} className="tag type-caption">
                    {d.slice(5)}
                  </span>
                ))}
                {days.length > 12 && (
                  <span className="tag type-caption">+{days.length - 12} more</span>
                )}
              </div>
            </div>
          )}
        </Card>

        {error && (
          <p role="alert" className="type-note text-t-critical">
            {error} Nothing was added.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="primary" disabled={!ready || saving} onClick={() => void save()}>
            {saving ? 'Adding' : `Add ${days.length || ''} ${days.length === 1 ? 'item' : 'items'}`}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Four months on, clamped to the end of the month. Local dates only. */
function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
