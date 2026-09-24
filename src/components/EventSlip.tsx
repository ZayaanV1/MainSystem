import { readTitle } from '../lib/blocks';
import { formatTime } from '../lib/time';
import type { Course, PlannerEvent } from '../lib/planner';
import { tint } from './calendar/items';

/**
 * An event, as a slip of its course's glass.
 *
 * The counterpart to AssignmentRow for things you attend rather than finish:
 * the same material and the same kicker-over-title shape, and no ring,
 * because you do not complete an exam — you sit it. Giving it a checkbox would
 * imply it is optional, and leaving one unticked forever would make the day
 * look unfinished.
 *
 * Timetable titles are read apart the same way the Week styles read them, so
 * "MB S2.210 - COEN 231-U - LEC" is "COEN 231 Lecture" here too.
 */
export function EventSlip({
  event,
  course,
  showSource = false,
}: {
  event: PlannerEvent;
  course?: Course;
  showSource?: boolean;
}) {
  const read = readTitle(event.title);
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  const when = event.all_day
    ? 'All day'
    : `${formatTime(start)}${end ? ` – ${formatTime(end)}` : ''}`;

  const place = event.location
    ? event.location
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ')
    : read.room;

  const name = course?.name?.trim();
  const detail =
    name && name !== course?.code && !event.title.toLowerCase().includes(name.toLowerCase())
      ? name
      : null;

  return (
    <div className="mat slip flex items-stretch" data-block style={tint(course)}>
      <span aria-hidden className="slip-bar" style={{ backgroundColor: 'var(--blk-mark)' }} />
      <div className="flex min-h-[var(--tap)] min-w-0 flex-1 flex-col justify-center gap-1 py-3.5 pr-4 pl-5">
        <span className="kicker">
          <span className="blk-num normal-case tracking-normal">{when}</span>
          {showSource && event.source && (
            <>
              <span aria-hidden>·</span>
              <span>{event.source}</span>
            </>
          )}
        </span>
        <span className="slip-title text-text-hi">{read.headline}</span>
        {(detail || read.section || place) && (
          <span className="type-note text-text-mid">
            {[detail, read.section, place].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}
