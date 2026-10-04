import { readTitle } from '../lib/blocks';
import { formatTime, formatTimeRange } from '../lib/time';
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
  const when = event.all_day ? 'All day' : formatTimeRange(start, end);

  /*
   * The start large and the rest of the time on its own line under it: "10:15"
   * over "to 11:30 a.m.", or "3:00" over "p.m.". A kicker line holding the
   * whole range was the smallest text on the slip and the thing it is read
   * for; a column of start times also lines the day up to read down.
   */
  const split = (d: Date) => {
    const m = /^(\d{1,2}:\d{2})\s*(.*)$/u.exec(formatTime(d));
    return m ? { hm: m[1], period: m[2] } : { hm: formatTime(d), period: '' };
  };
  const a = split(start);
  const b = end ? split(end) : null;
  const under = b ? (b.period === a.period ? `to ${b.hm} ${b.period}` : `${a.period} to ${b.hm} ${b.period}`) : a.period;

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
    <div className="mat slip ev-slip" data-block style={tint(course)}>
      <span className="ev-time">
        {event.all_day ? (
          <b>All day</b>
        ) : (
          <>
            {/* Read out as one range rather than as two fragments. */}
            <span className="sr-only">{when}</span>
            <b aria-hidden>{a.hm}</b>
            <span aria-hidden>{under}</span>
          </>
        )}
      </span>
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <span className="slip-title text-text-hi">{read.headline}</span>
        {(detail || read.section || place || (showSource && event.source)) && (
          <span className="type-note text-text-mid">
            {[detail, read.section, place, showSource ? event.source : null].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}
