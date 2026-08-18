import { AssignmentRow } from '../components/AssignmentRow';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { refillStatus } from '../lib/checklist';
import { essentialsFor } from '../../supabase/functions/_shared/lowbattery';
import { setAssignmentStatus, type Assignment, type Course, type TodayData } from '../lib/planner';
import { formatDay, todayKey } from '../lib/time';

/**
 * Today, turned down.
 *
 * On a bad day a full dashboard is a wall of evidence that you are behind, and
 * that is the day the app stops getting opened. This is the version of Today
 * that stays openable: two or three non-negotiables, one small piece of work,
 * and nothing else at all.
 *
 * Design decisions that carry the whole feature:
 *
 *   - Hidden, not reordered. A shorter list with the rest below it is the same
 *     wall one scroll away, and knowing it is down there is enough to keep it
 *     working on you.
 *   - One task, not a shortlist. Choosing between five things is itself the
 *     task you cannot face today.
 *   - The hidden work is counted and reassured about, never named. "Nine other
 *     things" is a fact; listing them is the wall again.
 *   - Nothing is marked skipped, deferred or missed. Turning this off returns
 *     the day exactly as it was. Low-battery mode must never generate a debt —
 *     if using it costs something later, it will not get used.
 *
 * The whole palette desaturates through one root attribute, so the interface
 * visibly gets quieter without any component here knowing that happened.
 */
export function LowBattery({
  data,
  onExit,
  onChanged,
  isDone,
  onToggleItem,
}: {
  data: TodayData;
  onExit: () => void;
  onChanged: () => void;
  isDone: (itemId: string) => boolean;
  onToggleItem: (itemId: string) => void;
}) {
  const today = todayKey();
  const { items, work, hiddenCount } = essentialsFor(data.items, data.assignments);

  const courseFor = (id: string | null): Course | undefined =>
    data.courses.find((c) => c.id === id);

  const allEssentialsDone = items.length > 0 && items.every((i) => isDone(i.id));

  return (
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-8 px-4">
        <h1 className="type-h1 text-text-hi">Today</h1>
        <p className="type-caption mt-1 text-text-low">{formatDay(today)}</p>
        <p className="type-body mt-4 text-text-mid">Just the essentials.</p>
      </header>

      {items.length > 0 && (
        <section className="mb-8">
          <Card>
            {items.map((item) => {
              const refill = refillStatus(item);
              return (
                <CheckRow
                  key={item.id}
                  label={item.title}
                  done={isDone(item.id)}
                  onToggle={() => onToggleItem(item.id)}
                  meta={refill.label ?? undefined}
                />
              );
            })}
          </Card>

          {allEssentialsDone && (
            <p className="mt-3 px-4 type-body text-t-done">That's the important part done.</p>
          )}
        </section>
      )}

      {items.length === 0 && (
        <section className="mb-8 px-4">
          <p className="type-body text-text-mid">
            Nothing is marked as essential yet. Open a checklist item and tick
            &ldquo;keep on a bad day&rdquo; to choose what shows up here.
          </p>
        </section>
      )}

      {work && (
        <section className="mb-8">
          <h2 className="type-label mb-3 px-4 text-text-mid">If you have it in you</h2>
          <Card>
            <AssignmentRow
              assignment={work as Assignment}
              course={courseFor((work as Assignment).course_id)}
              onToggleDone={() =>
                void setAssignmentStatus(
                  (work as Assignment).id,
                  (work as Assignment).status === 'done' ? 'todo' : 'done',
                ).then(onChanged)
              }
            />
          </Card>
        </section>
      )}

      <div className="flex-1" />

      <footer className="border-t border-ink-600 px-4 py-6">
        {hiddenCount > 0 && (
          // Counted, never named, and explicitly not a debt.
          <p className="mb-4 type-caption text-text-low">
            {hiddenCount} other {hiddenCount === 1 ? 'thing is' : 'things are'} hidden. They keep.
          </p>
        )}
        <Button onClick={onExit}>Show everything</Button>
      </footer>
    </main>
  );
}
