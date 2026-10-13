import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { useAuth } from '../lib/auth';
import { durationLabel } from '../lib/blocks';
import { flush } from '../lib/outbox';
import { addEvent, type TodayData } from '../lib/planner';
import { suggestBlocks, type Busy } from '../lib/suggestBlocks';
import { formatDay, formatTime, localDayKey, localHourMinute, todayKey, wallClockToUTC, type DayKey } from '../lib/time';

/**
 * Time for the week's work, found in the gaps that are actually free and
 * offered as blocks to keep or drop (lib/suggestBlocks.ts).
 *
 * A kept block becomes a calendar event ("Work on: Problem set 4"), so it
 * shows in Week and Today and in the calendar feed like any other event.
 * Nothing moves on its own, and nothing already in the calendar is touched.
 */
export function PlanBlocks({ data, onClose, onAdded }: { data: TodayData; onClose: () => void; onAdded: () => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const result = useMemo(() => {
    const local = (d: Date) => {
      const { hour, minute } = localHourMinute(d);
      return { day: localDayKey(d), minute: hour * 60 + minute };
    };
    // Timed events are busy; one with no end is taken as an hour long.
    const busy: Busy[] = [];
    for (const e of data.events) {
      if (e.all_day) continue;
      const start = new Date(e.starts_at);
      const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 60 * 60_000);
      const a = local(start);
      const b = local(end);
      if (a.day === b.day) busy.push({ day: a.day, start: a.minute, end: Math.max(a.minute + 1, b.minute) });
      else {
        busy.push({ day: a.day, start: a.minute, end: 24 * 60 });
        busy.push({ day: b.day, start: 0, end: b.minute });
      }
    }
    const now = local(new Date());
    return suggestBlocks(data.assignments, busy, { today: todayKey(), nowMinute: now.minute, local });
  }, [data]);

  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const kept = result.suggestions.filter((_, i) => !dropped.has(i));

  async function add() {
    setBusy(true);
    for (const s of kept) {
      await addEvent(userId, {
        title: `Work on: ${s.title}`,
        kind: 'other',
        day: s.day,
        time: hhmm(s.start),
        minutes: s.minutes,
        course_id: s.course_id,
        notes: 'A suggested block. Delete it like any event if the time stops working.',
      });
    }
    await flush();
    setBusy(false);
    onAdded();
    onClose();
  }

  const byDay = new Map<DayKey, { s: (typeof result.suggestions)[number]; i: number }[]>();
  result.suggestions.forEach((s, i) => byDay.set(s.day, [...(byDay.get(s.day) ?? []), { s, i }]));

  return (
    <Sheet open title="Time for this week’s work" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {result.suggestions.length === 0 ? (
          <p className="type-body text-text-mid">
            {result.unsized
              ? 'Nothing to place: the work due this week has no estimates yet. Give a piece of work an estimate and it can be given a time.'
              : 'Nothing to place. There is no estimated work due in the next seven days.'}
          </p>
        ) : (
          <p className="type-body text-text-mid">
            Blocks in the time you have free between 9 a.m. and 9 p.m., soonest due first, spread over days. Keep the ones that suit; nothing is added until you say.
          </p>
        )}

        {[...byDay].map(([day, rows]) => (
          <section key={day} className="flex flex-col gap-2">
            <p className="kicker px-1">{day === todayKey() ? 'Today' : formatDay(day)}</p>
            <div className="mat flex flex-col">
              {rows.map(({ s, i }) => {
                const off = dropped.has(i);
                const start = wallClockToUTC(s.day, Math.floor(s.start / 60), s.start % 60);
                const end = new Date(start.getTime() + s.minutes * 60_000);
                return (
                  <label key={i} className="mat-row prep-row" data-dropped={off || undefined}>
                    <input
                      type="checkbox"
                      className="settings-switch"
                      checked={!off}
                      onChange={(e) =>
                        setDropped((d) => {
                          const next = new Set(d);
                          if (e.target.checked) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block type-label text-text-hi">
                        {formatTime(start)} – {formatTime(end)}
                      </span>
                      <span className="block truncate type-note text-text-mid">
                        {s.title} · {durationLabel(s.minutes)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}

        {(result.unsized > 0 || result.unplaced > 0) && result.suggestions.length > 0 && (
          <p className="type-note text-text-low">
            {[
              result.unsized ? `${result.unsized} ${result.unsized === 1 ? 'piece of work has' : 'pieces of work have'} no estimate, so ${result.unsized === 1 ? 'it was' : 'they were'} left out` : null,
              result.unplaced ? `${result.unplaced} didn’t fully fit before ${result.unplaced === 1 ? 'it is' : 'they are'} due` : null,
            ]
              .filter(Boolean)
              .join('; ')}
            .
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {result.suggestions.length > 0 && (
            <Button variant="primary" disabled={busy || kept.length === 0} onClick={() => void add()}>
              {busy ? 'Adding' : kept.length ? `Add ${kept.length} ${kept.length === 1 ? 'block' : 'blocks'}` : 'Nothing kept'}
            </Button>
          )}
          <Button variant="quiet" onClick={onClose}>
            {result.suggestions.length ? 'Not now' : 'Close'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
