import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import type { ChecklistItem } from '../lib/checklist';
import {
  addChecklistItem,
  deactivateChecklistItem,
  updateChecklistItem,
  type ChecklistFields,
} from '../lib/planner';
import { todayKey } from '../lib/time';

/**
 * Add or edit a checklist item.
 *
 * The dose count lives here rather than only in a script, because the number
 * changes on the day a prescription is collected and needing a terminal to
 * record that is exactly the sort of friction that ends with the counter being
 * wrong and then ignored.
 *
 * Nothing here is required except a title. Recurrence defaults to daily, doses
 * are off unless asked for.
 */

const WEEKDAYS = [
  [1, 'M'],
  [2, 'T'],
  [3, 'W'],
  [4, 'T'],
  [5, 'F'],
  [6, 'S'],
  [7, 'S'],
] as const;

const blank = (): ChecklistFields => ({
  title: '',
  recurrence: 'daily',
  weekdays: [1, 2, 3, 4, 5],
  interval_days: 7,
  anchor_day: todayKey(),
  tracks_doses: false,
  doses_remaining: 0,
  doses_per_completion: 1,
  refill_warning_days: 3,
});

const fromItem = (i: ChecklistItem): ChecklistFields => ({
  title: i.title,
  recurrence: i.recurrence,
  weekdays: i.weekdays ?? [1, 2, 3, 4, 5],
  interval_days: i.interval_days ?? 7,
  anchor_day: i.anchor_day ?? todayKey(),
  tracks_doses: i.tracks_doses,
  doses_remaining: i.doses_remaining ?? 0,
  doses_per_completion: i.doses_per_completion,
  refill_warning_days: i.refill_warning_days,
});

export function ChecklistEditor({
  open,
  item,
  userId,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null when adding. */
  item: ChecklistItem | null;
  userId: string;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<ChecklistFields>(() =>
    item ? fromItem(item) : blank(),
  );
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ChecklistFields>(key: K, value: ChecklistFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const toggleWeekday = (d: number) =>
    setFields((f) => {
      const current = f.weekdays ?? [];
      return {
        ...f,
        weekdays: current.includes(d)
          ? current.filter((x) => x !== d)
          : [...current, d].sort((a, b) => a - b),
      };
    });

  // The database rejects a weekdays item with no weekdays, so the button is
  // disabled rather than letting a save fail with a constraint error.
  const invalidWeekdays =
    fields.recurrence === 'weekdays' && (fields.weekdays ?? []).length === 0;
  const canSave = fields.title.trim().length > 0 && !invalidWeekdays && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    try {
      if (item) await updateChecklistItem(item.id, fields);
      else await addChecklistItem(userId, fields, nextSortOrder);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    await deactivateChecklistItem(item.id);
    onSaved();
    onClose();
  }

  const perDay = Math.max(1, fields.doses_per_completion);
  const daysOfSupply = Math.floor((fields.doses_remaining ?? 0) / perDay);

  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Edit item' : 'New item'}>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Field
          label="Name"
          value={fields.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Creatine"
          autoFocus
        />

        <div className="flex flex-col gap-3">
          <span className="type-label text-text-mid">Repeats</span>
          <div className="flex flex-wrap gap-2">
            {(['daily', 'weekdays', 'interval'] as const).map((r) => (
              <Chip
                key={r}
                selected={fields.recurrence === r}
                onClick={() => set('recurrence', r)}
              >
                {r === 'daily' ? 'Every day' : r === 'weekdays' ? 'Certain days' : 'Every N days'}
              </Chip>
            ))}
          </div>

          {fields.recurrence === 'weekdays' && (
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map(([n, label], i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(n)}
                  aria-pressed={(fields.weekdays ?? []).includes(n)}
                  aria-label={
                    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]
                  }
                  className={[
                    'flex h-11 w-11 items-center justify-center rounded-pill type-label',
                    (fields.weekdays ?? []).includes(n)
                      ? 'bg-ink-600 text-text-hi'
                      : 'border border-ink-600 text-text-low',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {fields.recurrence === 'interval' && (
            <Field
              label="Days between"
              type="number"
              inputMode="numeric"
              min={1}
              value={fields.interval_days ?? 7}
              onChange={(e) => set('interval_days', Number(e.target.value) || 1)}
              hint={`Counting from ${fields.anchor_day}`}
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => set('tracks_doses', !fields.tracks_doses)}
            aria-pressed={fields.tracks_doses}
            className="flex items-center gap-3 text-left"
          >
            <span
              aria-hidden
              className={[
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
                fields.tracks_doses ? 'border-t-done bg-t-done' : 'border-ink-600',
              ].join(' ')}
            />
            <span className="type-label text-text-hi">Count doses</span>
          </button>

          {fields.tracks_doses && (
            <div className="flex flex-col gap-4">
              <Field
                label="Doses left"
                type="number"
                inputMode="numeric"
                min={0}
                value={fields.doses_remaining ?? 0}
                onChange={(e) => set('doses_remaining', Math.max(0, Number(e.target.value) || 0))}
                hint={`${daysOfSupply} ${daysOfSupply === 1 ? 'day' : 'days'} of supply`}
              />
              <Field
                label="Taken per day"
                type="number"
                inputMode="numeric"
                min={1}
                value={fields.doses_per_completion}
                onChange={(e) => set('doses_per_completion', Number(e.target.value) || 1)}
              />
              <Field
                label="Warn this many days ahead"
                type="number"
                inputMode="numeric"
                min={0}
                value={fields.refill_warning_days}
                onChange={(e) => set('refill_warning_days', Math.max(0, Number(e.target.value) || 0))}
                hint="Set this to how long a refill actually takes to get."
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saving ? 'Saving' : 'Save'}
          </Button>
          {item && (
            <Button variant="quiet" onClick={() => void remove()}>
              Remove from list
            </Button>
          )}
        </div>

        {invalidWeekdays && (
          <p className="type-caption text-t-overdue">
            Pick at least one day, or this never appears.
          </p>
        )}
      </form>
    </Sheet>
  );
}
