import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { dueOn, recentDays, refillStatus, type ChecklistItem } from '../lib/checklist';
import { BACKFILL_DAYS } from '../lib/planner';
import { formatDay, rolloverDay, type DayKey } from '../lib/time';

/**
 * The whole checklist, behind Today's last pill.
 *
 * Everything the old checklist card did that is not ticking today: the full
 * rows with their refill sentences, the five-day strip for a day you missed,
 * editing and adding. It is a sheet because it is a short, deliberate visit —
 * the opposite of the pills, which are a glance.
 *
 * Opening an item to edit it, or the month of history, closes this first:
 * one sheet at a time, so Back always means one thing.
 */
export function ChecklistSheet({
  items,
  today,
  isDone,
  onToggle,
  onEdit,
  onFillIn,
  onClose,
}: {
  items: ChecklistItem[];
  today: DayKey;
  isDone: (itemId: string, day: DayKey) => boolean;
  onToggle: (itemId: string, day: DayKey) => void;
  /** An item to edit, or null to add one. */
  onEdit: (item: ChecklistItem | null) => void;
  onFillIn: () => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState<DayKey>(today);
  const [editing, setEditing] = useState(false);

  // Left open past midnight (an installed app stays alive overnight), a
  // selection that was "today" follows the day; one picked on purpose to
  // back-fill stays picked while it is still in the strip.
  const lastToday = useRef(today);
  useEffect(() => {
    const previous = lastToday.current;
    if (previous === today) return;
    lastToday.current = today;
    setDay((selected) => rolloverDay(previous, today, selected, BACKFILL_DAYS));
  }, [today]);
  const due = dueOn(items, day);
  const allDone = due.length > 0 && due.every((i) => isDone(i.id, day));

  return (
    <Sheet open onClose={onClose} title="Checklist">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="kicker">{day === today ? `Today, ${formatDay(day)}` : formatDay(day)}</span>
          {!editing && <DayStrip today={today} selected={day} onSelect={setDay} />}
        </div>

        {due.length === 0 ? (
          <EmptyState action={<Button onClick={() => onEdit(null)}>Add an item</Button>}>
            {items.length === 0 ? 'Nothing on the checklist yet.' : 'Nothing was on the list that day.'}
          </EmptyState>
        ) : (
          <Card>
            {due.map((item) => {
              const refill = refillStatus(item);
              return (
                <CheckRow
                  key={item.id}
                  label={item.title}
                  // In edit mode the row opens its settings instead of ticking:
                  // one target per row either way.
                  done={editing ? false : isDone(item.id, day)}
                  onToggle={() => (editing ? onEdit(item) : onToggle(item.id, day))}
                  meta={
                    editing ? (
                      <span className="text-text-mid">Edit</span>
                    ) : refill.label ? (
                      <span className={refill.needsRefill ? 'text-t-critical' : undefined}>{refill.label}</span>
                    ) : undefined
                  }
                />
              );
            })}
          </Card>
        )}

        {/* Said once, for this day, and never compared to any other. */}
        {!editing && allDone && (
          <p className="type-body text-t-done">
            {day === today ? "That's everything for today." : "That's everything for that day."}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {editing ? (
            <>
              <Button variant="quiet" onClick={() => onEdit(null)}>
                Add an item
              </Button>
              <Button variant="quiet" onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          ) : (
            items.length > 0 && (
              <>
                <Button variant="quiet" onClick={() => setEditing(true)}>
                  Edit list
                </Button>
                <Button variant="quiet" onClick={onFillIn}>
                  Fill in a day
                </Button>
              </>
            )
          )}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The back-fill strip.
 *
 * Five days, no further. This is the one place the no-streak-shaming rule is
 * easiest to break: a longer window turns into a record of every day missed.
 * Days carry no completion state and no colour — they are a way to reach
 * yesterday, not a report card.
 */
function DayStrip({
  today,
  selected,
  onSelect,
}: {
  today: DayKey;
  selected: DayKey;
  onSelect: (d: DayKey) => void;
}) {
  const days = recentDays(today, BACKFILL_DAYS);

  return (
    <div className="flex gap-1" role="group" aria-label="Choose a day to fill in">
      {days.map((d) => {
        const isToday = d === today;
        const isSelected = d === selected;
        // UTC, because `d` is a calendar date rather than an instant: the
        // weekday of 2026-08-19 is Wednesday in every timezone.
        const weekday = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'UTC',
          weekday: 'narrow',
        }).format(new Date(`${d}T12:00:00Z`));

        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={isSelected}
            aria-label={isToday ? `Today, ${formatDay(d)}` : formatDay(d)}
            className={[
              // 36px to the eye, 44px to the thumb.
              'fx-depth hit-expand',
              'flex h-9 w-9 flex-col items-center justify-center rounded-pill type-caption',
              'min-h-0',
              isSelected ? 'bg-ink-600 text-text-hi' : 'text-text-low',
            ].join(' ')}
          >
            <span aria-hidden>{weekday}</span>
            {isToday && <span aria-hidden className="mt-0.5 h-1 w-1 rounded-pill bg-current" />}
          </button>
        );
      })}
    </div>
  );
}
