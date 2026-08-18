import { useState } from 'react';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { EmptyState } from '../components/EmptyState';
import { Sheet } from '../components/Sheet';
import type { ChecklistItem } from '../lib/checklist';
import { refillStatus } from '../lib/checklist';
import {
  asWeeks,
  buildHistory,
  describeDay,
  itemsFor,
  type CompletionRecord,
  type DayFill,
  type HistoryDay,
} from '../../supabase/functions/_shared/history';
import { completionKey, setCompletion } from '../lib/planner';
import { formatDay, todayKey, type DayKey } from '../lib/time';

/**
 * Checklist history.
 *
 * The most dangerous screen in this app. Rule 3 exists because a completion
 * history is one decision away from a wall of evidence that you are failing,
 * and the day that wall appears is the day the app stops being opened.
 *
 * So it is built as a BACK-FILL TOOL that happens to show history, not the
 * other way round. Its purpose is to make "I did that, I just didn't tick it"
 * a single tap. Everything on screen serves that.
 *
 * What is deliberately absent: any count, any percentage, any streak, any
 * "best run", any comparison between one day and another, any word for a day
 * that went untouched. Warmth about a finished day is fine; a running tally
 * is not, because a tally is something that can be lost. An empty day is drawn in
 * ground colour — the same colour as the card it sits on — so it reads as
 * nothing rather than as a hole. Five weeks, and no way to scroll further back,
 * because a longer record is a longer indictment.
 */

/**
 * Fills, chosen so a bad day is quiet.
 *
 * `open` deliberately renders as the card's own surface: visible as a cell,
 * invisible as a mark. Only completion adds ink to the page, and only in the
 * calm green that is used nowhere else.
 */
const FILL: Record<DayFill, string> = {
  // Nothing was expected: nothing is drawn.
  'none-due': 'bg-transparent',
  // Something was expected and is not ticked. One step off the sheet colour —
  // enough to find and tap, not enough to read as a mark against you. Drawn in
  // ink-600 rather than the sheet's own ink-700, which made it invisible and
  // indistinguishable from a day that asked nothing.
  open: 'bg-ink-600',
  partial: 'bg-t-done/40',
  complete: 'bg-t-done',
};

export function History({
  items,
  completions,
  userId,
  onClose,
  onChanged,
}: {
  items: ChecklistItem[];
  completions: CompletionRecord[];
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const today = todayKey();
  const [selected, setSelected] = useState<DayKey | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const weeks = asWeeks(buildHistory(items, completions, today));

  const doneKeys = new Set(completions.map((c) => completionKey(c.item_id, c.local_day)));
  const isDone = (itemId: string, day: DayKey) => {
    const key = completionKey(itemId, day);
    return pending.has(key) ? !doneKeys.has(key) : doneKeys.has(key);
  };

  async function toggle(itemId: string, day: DayKey) {
    const key = completionKey(itemId, day);
    const next = !isDone(itemId, day);
    setPending((p) => new Set(p).add(key));
    await setCompletion(userId, itemId, day, next, today);
    onChanged();
  }

  const dayItems = selected ? itemsFor(items, selected) : [];

  return (
    <Sheet open onClose={onClose} title="Fill in a day">
      <div className="flex flex-col gap-6">
        <p className="type-body text-text-mid">
          Tap a day to tick something off after the fact.
        </p>

        <div className="flex flex-col gap-1">
          {weeks.map((week, i) => (
            <div key={i} className="flex gap-1">
              {week.map((day) => (
                <DayCell
                  key={day.day}
                  day={day}
                  selected={day.day === selected}
                  onSelect={() => setSelected(day.day === selected ? null : day.day)}
                />
              ))}
            </div>
          ))}
        </div>

        {selected && (
          <div className="flex flex-col gap-3">
            <span className="type-label text-text-mid">
              {selected === today ? `Today, ${formatDay(selected)}` : formatDay(selected)}
            </span>

            {dayItems.length === 0 ? (
              <EmptyState>Nothing was on the list that day.</EmptyState>
            ) : (
              <Card>
                {dayItems.map((item) => {
                  const refill = refillStatus(item);
                  return (
                    <CheckRow
                      key={item.id}
                      label={item.title}
                      done={isDone(item.id, selected)}
                      onToggle={() => void toggle(item.id, selected)}
                      meta={refill.label ?? undefined}
                    />
                  );
                })}
              </Card>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function DayCell({
  day,
  selected,
  onSelect,
}: {
  day: HistoryDay;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={describeDay(day, formatDay(day.day))}
      className={[
        'flex aspect-square flex-1 items-center justify-center rounded-[4px]',
        'min-h-0',
        FILL[day.fill],
        // Today gets an outline rather than a fill, so "where am I" never
        // reads as "what did I do".
        day.isToday ? 'ring-1 ring-text-mid' : '',
        selected ? 'ring-2 ring-focus-ring' : '',
      ].join(' ')}
    />
  );
}
