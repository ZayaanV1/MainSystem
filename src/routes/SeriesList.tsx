import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import {
  deleteSeries,
  extendSeries,
  fillSeriesGaps,
  loadSeries,
  setSeriesActive,
  type Course,
  type SeriesSummary,
} from '../lib/planner';
import { describeSeries, MAX_INSTANCES } from '../../supabase/functions/_shared/series';
import { formatDay, todayKey } from '../lib/time';

/**
 * The patterns you have set up, and what to do about them.
 *
 * `assignment_series` was a write-only table: rows went in at creation and
 * nothing ever read one back. The schema had already been written as though
 * this screen existed — the table comment describes turning a series off, and
 * there is a partial index `where active` serving a query nobody had written.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *
 * Repeating work is the highest-leverage capture in the app and the hardest to
 * undo. One tap creates up to two hundred rows. Until now the only way to
 * correct a mistake — wrong weekday, wrong term end, a course dropped in
 * week three — was deleting them one at a time, which costs more than typing
 * them would have. A feature you cannot reverse is one people stop using after
 * the first time it goes wrong.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No full editor. Changing the weekday of a live series would mean deleting
 * instances that may already be done and regenerating around them, and there
 * is no answer to "what happens to the lab you finished on the old Tuesday"
 * that is not a guess. Ending the pattern and starting a new one is explicit,
 * loses nothing, and is what the underlying model actually supports.
 *
 * No count of what you missed. A series row says how many exist and how many
 * are done, and stops there — "4 of 12 done" is a fact about a term, while
 * "you missed 3" is a score, and rule 3 rules out the second.
 */

interface SeriesListProps {
  userId: string;
  courses: Course[];
  /** Bumped by the parent when work changes, so the list reloads. */
  refreshKey: number;
  onChanged: () => void;
}

export function SeriesList({ userId, courses, refreshKey, onChanged }: SeriesListProps) {
  const [items, setItems] = useState<SeriesSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SeriesSummary | null>(null);
  const [extending, setExtending] = useState<SeriesSummary | null>(null);

  const reload = useCallback(async () => {
    const { items: rows, error } = await loadSeries(userId);
    setFailed(Boolean(error));
    setItems(error ? [] : rows);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  async function run(id: string, fn: () => Promise<string | null>) {
    setBusy(id);
    setNote(null);
    const message = await fn();
    setBusy(null);
    if (message) setNote(message);
    await reload();
    onChanged();
  }

  // Nothing set up yet: the "Add repeating work" button directly above is the
  // whole of the answer, so a second empty state under it would be noise.
  if (!failed && items !== null && items.length === 0) return null;

  return (
    <div className="mt-4 px-4">
      {failed ? (
        <p className="type-note text-text-mid" role="alert">
          Could not load your repeating work.{' '}
          <button type="button" className="underline" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : (
        <Card>
          {(items ?? []).map((item) => {
            const { series } = item;
            const course = courses.find((c) => c.id === series.course_id);
            const capped = item.total >= MAX_INSTANCES;

            return (
              <div
                key={series.id}
                className="flex flex-col gap-2 border-b border-ink-600 px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="type-body text-text-hi">{series.title}</span>
                  {!series.active && <span className="tag type-caption">ENDED</span>}
                </div>

                <span className="type-note text-text-mid">
                  {describeSeries(series)}
                  {course && ` · ${course.code ?? course.name}`}
                </span>

                {/*
                  Two numbers, no verdict. How many exist and how many are
                  finished are facts about the term; anything derived from the
                  difference is a score across days.
                */}
                <span className="type-caption text-text-low">
                  {item.total} {item.total === 1 ? 'item' : 'items'} · {item.done} done
                </span>

                {item.missing.length > 0 && (
                  <p className="type-note text-text-mid">
                    {item.missing.length}{' '}
                    {item.missing.length === 1 ? 'date has' : 'dates have'} no work item
                    {capped &&
                      `, because generating stopped at ${MAX_INSTANCES}`}
                    . {formatDay(item.missing[0])}
                    {item.missing.length > 1 && ` to ${formatDay(item.missing[item.missing.length - 1])}`}.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {item.missing.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy === series.id}
                      onClick={() =>
                        void run(series.id, async () => {
                          const r = await fillSeriesGaps(userId, series.id);
                          return r.error ?? `Added ${r.created}.`;
                        })
                      }
                    >
                      Add the missing {item.missing.length}
                    </Button>
                  )}

                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy === series.id}
                    onClick={() => setExtending(item)}
                  >
                    Change the end date
                  </Button>

                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy === series.id}
                    onClick={() =>
                      void run(series.id, async () => {
                        const r = await setSeriesActive(series.id, !series.active);
                        return r.error;
                      })
                    }
                  >
                    {series.active ? 'Stop repeating' : 'Start again'}
                  </Button>

                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy === series.id}
                    onClick={() => setConfirming(item)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {note && (
        <p className="type-note mt-2 text-text-mid" role="status">
          {note}
        </p>
      )}

      {extending && (
        <ExtendSheet
          item={extending}
          onClose={() => setExtending(null)}
          onSave={(until) =>
            void run(extending.series.id, async () => {
              const r = await extendSeries(userId, extending.series.id, until);
              setExtending(null);
              return r.error ?? (r.created > 0 ? `Added ${r.created}.` : 'Date changed.');
            })
          }
        />
      )}

      {confirming && (
        <DeleteSheet
          item={confirming}
          onClose={() => setConfirming(null)}
          onDelete={(alsoRemove) =>
            void run(confirming.series.id, async () => {
              const r = await deleteSeries(userId, confirming.series.id, alsoRemove);
              setConfirming(null);
              if (r.error) return r.error;
              return alsoRemove
                ? `Pattern deleted, ${r.removed} unfinished ${r.removed === 1 ? 'item' : 'items'} removed.`
                : 'Pattern deleted. The work it made is still there.';
            })
          }
        />
      )}
    </div>
  );
}

/**
 * Moving the end of a term.
 *
 * The count is shown before saving for the same reason the creation preview
 * shows every date: this writes rows, and a number appearing after the fact is
 * how a bulk write becomes something you stop trusting.
 */
function ExtendSheet({
  item,
  onClose,
  onSave,
}: {
  item: SeriesSummary;
  onClose: () => void;
  onSave: (until: string) => void;
}) {
  const [until, setUntil] = useState(item.series.until_day);
  const moved = until !== item.series.until_day;
  const later = until > item.series.until_day;

  return (
    <Sheet open onClose={onClose} title="Change the end date">
      <div className="flex flex-col gap-4">
        <p className="type-body text-text-mid">
          {item.series.title} currently runs to {formatDay(item.series.until_day)}.
        </p>

        <Field
          label="Until"
          type="date"
          value={until}
          min={item.series.anchor_day}
          onChange={(e) => setUntil(e.target.value)}
          hint="The last day an item may fall on."
        />

        {moved && (
          <p className="type-note text-text-mid">
            {later
              ? 'Moving it later adds the dates in between.'
              : 'Moving it earlier stops new items being made. Anything already on the calendar stays — delete the pattern if you want those removed too.'}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!moved || until < item.series.anchor_day}
            onClick={() => onSave(until)}
          >
            Save
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Deleting a pattern, and the separate question of its work.
 *
 * The default keeps everything, because the foreign key orphans instances
 * rather than removing them and that is the safe direction. Removing is opt-in
 * and is scoped narrowly on purpose: unfinished work due today or later, and
 * nothing else. Finished work is a record of the term, and past unfinished
 * work is what rule 3 says stays neutrally visible and back-fillable.
 */
function DeleteSheet({
  item,
  onClose,
  onDelete,
}: {
  item: SeriesSummary;
  onClose: () => void;
  onDelete: (alsoRemove: boolean) => void;
}) {
  const [alsoRemove, setAlsoRemove] = useState(false);
  const today = todayKey();

  return (
    <Sheet open onClose={onClose} title="Delete this pattern">
      <div className="flex flex-col gap-4">
        <p className="type-body text-text-mid">
          {describeSeries(item.series)}. It has made {item.total}{' '}
          {item.total === 1 ? 'item' : 'items'}, {item.done} of them done.
        </p>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={alsoRemove}
            onChange={(e) => setAlsoRemove(e.target.checked)}
            className="mt-1 size-5 shrink-0"
          />
          <span className="flex flex-col gap-1">
            <span className="type-body text-text-hi">
              Also remove the ones not done yet
            </span>
            <span className="type-note text-text-low">
              From {formatDay(today)} onwards. Anything finished, and anything
              already past, stays exactly where it is.
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <Button variant="primary" onClick={() => onDelete(alsoRemove)}>
            Delete
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
