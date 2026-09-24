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

  return (
    <section aria-label={current ? 'Happening now' : 'Up next'} className="mb-8 px-4">
      <div
        className="mat mat-raised slip overflow-hidden px-5 py-4"
        data-block
        style={{ ...tint(course), '--mat-r': 'var(--r-hero)' } as CSSProperties}
      >
        <span aria-hidden className="slip-bar" style={{ backgroundColor: 'var(--blk-mark)' }} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker mb-2">
              {current ? (
                <span className="now-pill">Now</span>
              ) : (
                <span>
                  Next · in{' '}
                  <span className="blk-num normal-case tracking-normal">
                    {minutesAway < 60 ? `${minutesAway} min` : durationLabel(minutesAway)}
                  </span>
                </span>
              )}
            </p>
            <p className="slip-title text-text-hi" style={{ fontSize: '1.25rem' }}>{read.headline}</p>
            <p className="mt-1 type-note text-text-mid">
              {[`${formatTime(start)}${end ? ` – ${formatTime(end)}` : ''}`, read.section, place]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {/* The one number that matters, at display size. */}
          <div className="flex shrink-0 flex-col items-end">
            <span className="slip-count text-text-hi">
              {current && leftNow !== null
                ? leftNow < 60
                  ? leftNow
                  : durationLabel(leftNow)
                : formatTime(start).replace(/\s*[ap]\.m\.$/u, '')}
            </span>
            <span className="type-caption text-text-low">
              {current ? (leftNow !== null && leftNow < 60 ? 'min left' : 'left') : formatTime(start).replace(/^[\d:]+\s*/u, '')}
            </span>
          </div>
        </div>

        {after > 0 && (
          <p className="mt-3 type-note text-text-low">
            {after === 1 ? 'Then one more today.' : `Then ${after} more today.`}
          </p>
        )}

        {progress !== null && (
          <span
            aria-hidden
            className="bubble-progress"
            style={{ '--p': progress } as CSSProperties}
          />
        )}
      </div>
    </section>
  );
}
