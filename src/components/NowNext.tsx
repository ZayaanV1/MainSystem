import type { CSSProperties } from 'react';
import { readTitle, progressThrough, durationLabel } from '../lib/blocks';
import { formatTime, localDayKey, type DayKey } from '../lib/time';
import type { Course, PlannerEvent } from '../lib/planner';
import { useNow } from '../lib/useNow';
import { tint } from './calendar/items';

/**
 * Where you are supposed to be, right now or next.
 *
 * Today answered "what do I do right now" with a checklist, a list of
 * deadlines and an inbox — and never mentioned the lecture you are sitting in
 * or the lab you are about to be late for. Those were only on Week and Month,
 * one tap away, which on the screen built to need no taps was the wrong side
 * of the line.
 *
 * So the top of the day carries the one event that matters this minute: the
 * one under way, with how far through it you are, or else the next one, with
 * how long until it starts. It says nothing at all once the day's calendar is
 * over — an empty card at 10pm would be the app filling space.
 */
export function NowNext({
  events,
  today,
  courseFor,
}: {
  events: PlannerEvent[];
  today: DayKey;
  courseFor: (id: string | null) => Course | undefined;
}) {
  const now = useNow();

  const todays = events
    .filter((e) => !e.all_day && localDayKey(new Date(e.starts_at)) === today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const current = todays.find((e) => progressThrough(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, now) !== null);
  const next = todays.find((e) => new Date(e.starts_at).getTime() > now.getTime());
  const shown = current ?? next;
  if (!shown) return null;

  const start = new Date(shown.starts_at);
  const end = shown.ends_at ? new Date(shown.ends_at) : null;
  const read = readTitle(shown.title);
  const course = courseFor(shown.course_id);
  const progress = current ? progressThrough(start, end, now) : null;
  const minutesAway = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
  const after = todays.filter((e) => new Date(e.starts_at).getTime() > start.getTime()).length;

  const place = shown.location
    ? shown.location
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ')
    : read.room;

  const leftNow = current && end ? Math.max(0, Math.round((end.getTime() - now.getTime()) / 60_000)) : null;

  // The one after, written small beneath: a timetable shows what follows.
  const then = todays.find((e) => new Date(e.starts_at).getTime() > start.getTime()) ?? null;
  const thenRead = then ? readTitle(then.title) : null;
  const span = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)) : null;
  const clock = (d: Date) => formatTime(d).replace(/\s*[ap]\.m\.$/u, '');

  /*
   * A printed Swiss timetable (Phase B): the time as a big tabular numeral,
   * what and where beside it, how long until it in words, a rule that fills
   * as the class runs, and the next one after it in small type. Course glass
   * is kept, so a lecture still reads as its course.
   */
  return (
    <section aria-label={current ? 'Happening now' : 'Up next'} className="mb-8 px-4">
      <div
        className="mat mat-raised timetable overflow-hidden"
        data-block
        style={{ ...tint(course), '--mat-r': 'var(--r-hero)' } as CSSProperties}
      >
        <div className="tt-row">
          <span className="tt-time">{clock(start)}</span>
          <span className="tt-what">
            <b>{read.headline}</b>
            <span>{[read.section, place, span ? durationLabel(span) : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span className={current ? 'now-pill' : 'tt-away'}>
            {current
              ? 'Now'
              : `in ${minutesAway < 60 ? `${minutesAway} min` : durationLabel(minutesAway)}`}
          </span>
        </div>

        {current && progress !== null && (
          <div className="tt-line" aria-hidden>
            <span style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
          </div>
        )}
        {current && leftNow !== null && (
          <p className="type-note -mt-1 text-text-mid">
            {leftNow < 60 ? `${leftNow} min left` : `${durationLabel(leftNow)} left`}
          </p>
        )}

        {then && thenRead && (
          <>
            <div className="tt-rule" aria-hidden />
            <div className="tt-row tt-then">
              <span className="tt-time">{clock(new Date(then.starts_at))}</span>
              <span className="tt-what">
                <b>{thenRead.headline}</b>
                {after > 1 && <span>{after - 1 === 1 ? 'and one more today' : `and ${after - 1} more today`}</span>}
              </span>
              <span className="tt-away tt-quiet">then</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
