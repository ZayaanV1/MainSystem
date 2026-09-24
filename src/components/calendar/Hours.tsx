import type { CSSProperties } from 'react';
import { durationLabel, hourRange, minuteOfDay, placeSpans } from '../../lib/blocks';
import { effortMinutes, type DayGroup } from '../../lib/week';
import { useMediaQuery } from '../../lib/useMediaQuery';
import {
  buildDay,
  clock,
  dayNames,
  effortLabel,
  hourLabel,
  spansOf,
  tint,
  type DueItem,
  type EventItem,
  type Item,
} from './items';
import { DueToggle, type StyleProps } from './WeekStyles';

/**
 * Hours — the week on a real time axis.
 *
 * Two layouts, because the right grid depends on the screen. At desktop width
 * it is the calendar everyone already knows how to read: seven columns on one
 * shared axis, so Tuesday's 14:00 lines up with Thursday's. On a phone seven
 * columns would be forty pixels each, which is a bar chart of the week rather
 * than a calendar, so each day gets its own grid fitted to its own hours.
 *
 * Overlapping events sit side by side (placeSpans), never on top of each
 * other. Deadlines and instants — an assignment due at 23:59, a quiz that
 * "becomes available" — are not spans, so they are drawn as a flag on a
 * hairline at their minute rather than as a sliver pretending to have length.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function HoursWeek(props: StyleProps) {
  const wide = useMediaQuery('(min-width: 64rem)');
  const perDay = props.days.map((group) => ({
    group,
    items: buildDay(group, props.courseFor, props.progressFor, props.now),
  }));

  if (!wide) {
    return (
      <div className="flex flex-col gap-8 px-4 pb-4">
        {perDay.map(({ group, items }) => (
          <NarrowDay key={group.day} group={group} items={items} props={props} />
        ))}
      </div>
    );
  }

  const [from, to] = hourRange(perDay.flatMap(({ items }) => minutesIn(items)), { minSpan: 8 });
  const nowMin = minuteOfDay(props.now);
  const nowInRange = nowMin >= from * 60 && nowMin <= to * 60;
  const anyAllDay = perDay.some(({ items }) => items.some(isAllDayish));

  return (
    <div className="hours px-4 pb-4" style={vars({ '--span': to - from })}>
      <div className="grid" style={{ gridTemplateColumns: '3.5rem repeat(7, minmax(0, 1fr))' }}>
        <div className="sticky top-0 z-10 bg-ink-900" />
        {perDay.map(({ group }) => (
          <ColumnHead key={group.day} group={group} isToday={group.day === props.today} />
        ))}

        {anyAllDay && (
          <>
            <div className="flex items-center justify-end pr-2 type-caption text-text-low">All day</div>
            {perDay.map(({ group, items }) => (
              <div key={group.day} className="flex min-w-0 flex-col gap-1 border-l border-ink-600 p-1">
                <AllDay items={items} props={props} />
              </div>
            ))}
          </>
        )}

        <Axis from={from} to={to} />
        {perDay.map(({ group, items }) => (
          <Column
            key={group.day}
            items={items}
            from={from}
            span={to - from}
            isToday={group.day === props.today}
            nowMin={nowInRange ? nowMin : null}
            props={props}
          />
        ))}
      </div>
    </div>
  );
}

function ColumnHead({ group, isToday }: { group: DayGroup; isToday: boolean }) {
  const n = dayNames(group.day);
  const minutes = effortMinutes(group);
  return (
    <div className="sticky top-0 z-10 flex flex-col items-center gap-1 bg-ink-900 pb-2">
      <span className={`type-caption ${isToday ? 'text-text-hi' : 'text-text-low'}`}>{n.weekdayShort}</span>
      <span className="day-head" data-today={isToday || undefined} style={{ padding: 0 }}>
        <span className="day-head-date" style={isToday ? undefined : { fontSize: '1.375rem' }}>
          {n.date}
        </span>
      </span>
      {minutes > 0 && <span className="tag type-caption">{effortLabel(minutes)}</span>}
    </div>
  );
}

function NarrowDay({ group, items, props }: { group: DayGroup; items: Item[]; props: StyleProps }) {
  const isToday = group.day === props.today;
  const n = dayNames(group.day);
  const minutes = effortMinutes(group);
  const [from, to] = hourRange(minutesIn(items));
  const nowMin = minuteOfDay(props.now);
  const timed = items.filter((i) => !isAllDayish(i));

  return (
    <section aria-label={n.weekday}>
      <header className="day-head" data-today={isToday || undefined}>
        <span className="day-head-date">{n.date}</span>
        <span className="flex flex-col">
          <span className="type-label text-text-hi">{isToday ? `Today · ${n.weekday}` : n.weekday}</span>
          <span className="type-caption text-text-low">{n.month}</span>
        </span>
        <span aria-hidden className="day-head-rule" />
        {minutes > 0 && <span className="tag type-caption">{effortLabel(minutes)} of work</span>}
      </header>

      {items.some(isAllDayish) && (
        <div className="mb-2 ml-12 flex flex-col gap-1">
          <AllDay items={items} props={props} />
        </div>
      )}

      {timed.length > 0 && (
        <div className="hours" style={vars({ '--span': to - from, '--hour': '3.75rem' })}>
          <div className="grid" style={{ gridTemplateColumns: '3rem minmax(0, 1fr)' }}>
            <Axis from={from} to={to} />
            <Column
              items={items}
              from={from}
              span={to - from}
              isToday={isToday}
              nowMin={isToday && nowMin >= from * 60 && nowMin <= to * 60 ? nowMin : null}
              props={props}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Axis({ from, to }: { from: number; to: number }) {
  const hours = Array.from({ length: to - from - 1 }, (_, i) => from + i + 1);
  return (
    <div className="hours-axis" aria-hidden>
      {hours.map((h) => (
        <span key={h} style={{ top: `calc(${h - from} * var(--hour))` }}>
          {hourLabel(h)}
        </span>
      ))}
    </div>
  );
}

function Column({
  items,
  from,
  span,
  isToday,
  nowMin,
  props,
}: {
  items: Item[];
  from: number;
  /** Hours the grid shows. */
  span: number;
  isToday: boolean;
  /** Where now falls, when it is on this grid at all. */
  nowMin: number | null;
  props: StyleProps;
}) {
  const origin = from * 60;
  const events = new Map(
    items.filter((i): i is EventItem => i.kind === 'event').map((i) => [i.id, i]),
  );
  const placed = placeSpans(spansOf(items));
  const marks = items.filter(
    (i): i is DueItem | EventItem =>
      (i.kind === 'due' && i.timed) || (i.kind === 'event' && !i.allDay && i.endMin === null),
  );

  return (
    <div className="hours-col" data-today={isToday || undefined}>
      {placed.map((p) => {
        const it = events.get(p.id)!;
        const short = (p.end - p.start) < 40;
        const c = clock(it.start);
        const until = it.end ? clock(it.end) : null;
        return (
          <div
            key={p.id}
            className="hours-block blk-enter"
            data-block
            data-past={it.state === 'past' || undefined}
            data-now={it.state === 'now' || undefined}
            title={`${it.headline}, ${c.hm} ${c.suffix}${until ? ` to ${until.hm} ${until.suffix}` : ''}${it.place ? `, ${it.place}` : ''}`}
            style={tint(it.course, {
              '--top': p.start - origin,
              '--len': p.end - p.start,
              '--lane': p.lane,
              '--lanes': p.lanes,
              '--i': p.lane,
            })}
          >
            <b className="hours-title">{it.headline}</b>
            {!short && (
              <small className="hours-meta blk-num">
                {c.hm}
                {until ? `–${until.hm} ${until.suffix}` : ` ${c.suffix}`}
                {it.mins !== null ? ` · ${durationLabel(it.mins)}` : ''}
              </small>
            )}
            {!short && it.place && <small className="hours-meta">{it.place}</small>}
            {it.state === 'past' && <span className="sr-only">Finished.</span>}
            {it.state === 'now' && <span className="sr-only">Happening now.</span>}
          </div>
        );
      })}

      {marks.map((m) => {
        const at = m.startMin - origin;
        const edge = at < 0 ? 'top' : at > span * 60 ? 'bottom' : undefined;
        const when = clock(m.kind === 'due' ? m.at : m.start);
        return (
        <div
          key={m.id}
          className="hours-mark"
          data-edge={edge}
          style={vars({ '--top': Math.min(Math.max(at, 0), span * 60) })}
        >
          <div className="hours-flag">
            {m.kind === 'due' ? (
              <>
                <DueToggle a={m.assignment} onToggle={() => props.onToggle(m.assignment)} />
                {/* Two lines, so the title keeps its width in a seventh of a
                    screen: the name first, then how soon — and the time, when
                    the flag has been pinned away from it. */}
                <button
                  type="button"
                  onClick={() => props.onOpen(m.assignment)}
                  className="flex min-w-0 flex-col py-0.5 pr-1 text-left"
                  title={`${m.assignment.title}, ${m.urgency.label}`}
                >
                  <span className="truncate type-note font-semibold leading-tight text-text-hi">
                    {m.assignment.title}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 type-caption" style={{ color: `var(${m.urgency.colourVar})` }}>
                      {m.urgency.label}
                    </span>
                    {/* The time gives way first: how soon is the fact that
                        matters, and the edge the flag is pinned to already
                        says roughly when. */}
                    {edge && (
                      <span className="min-w-0 truncate type-caption text-text-low blk-num">
                        {when.hm} {when.suffix}
                      </span>
                    )}
                  </span>
                </button>
              </>
            ) : (
              <span className="flex min-w-0 items-center gap-2 py-1 pl-2" title={m.headline}>
                <span
                  aria-hidden
                  data-block
                  className="size-1.5 shrink-0 rounded-pill"
                  style={{ ...tint(m.course), backgroundColor: 'var(--blk-mark)' }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate type-note leading-tight text-text-mid">{m.headline}</span>
                  {edge && (
                    <span className="type-caption text-text-low blk-num">
                      {when.hm} {when.suffix}
                    </span>
                  )}
                </span>
              </span>
            )}
          </div>
        </div>
        );
      })}

      {nowMin !== null && (
        <div
          aria-hidden
          className="hours-now"
          data-ghost={isToday ? undefined : true}
          style={vars({ '--top': nowMin - origin })}
        />
      )}
    </div>
  );
}

/** All-day events and date-only deadlines: the strip above the grid. */
function AllDay({ items, props }: { items: Item[]; props: StyleProps }) {
  return (
    <>
      {items.filter(isAllDayish).map((it) =>
        it.kind === 'event' ? (
          <div
            key={it.id}
            className="hours-block"
            data-block
            style={tint(it.course, { '--top': 0, '--len': 0, '--lane': 0, '--lanes': 1 })}
            data-static
          >
            <b className="hours-title">{it.headline}</b>
          </div>
        ) : (
          <div key={it.id} className="hours-flag" data-static>
            <DueToggle a={it.assignment} onToggle={() => props.onToggle(it.assignment)} />
            <button
              type="button"
              onClick={() => props.onOpen(it.assignment)}
              className="flex min-w-0 flex-col py-0.5 pr-1 text-left"
            >
              <span className="truncate type-note font-semibold leading-tight text-text-hi">
                {it.assignment.title}
              </span>
              <span className="truncate type-caption" style={{ color: `var(${it.urgency.colourVar})` }}>
                {it.urgency.label}
              </span>
            </button>
          </div>
        ),
      )}
    </>
  );
}

function isAllDayish(i: Item): boolean {
  return (i.kind === 'event' && i.allDay) || (i.kind === 'due' && !i.timed);
}

/**
 * The minutes the grid is fitted to.
 *
 * Events only, when there are any. A deadline is a flag, and one WeBWorK due
 * at 12:00 a.m. was enough to stretch the whole week's grid back to
 * midnight — eight hours of empty rows above the first lecture, for the sake
 * of one flag. A deadline outside the fitted hours is pinned to the edge it
 * fell past instead, with its time written on it. Deadlines set the range
 * only for a day that has nothing else to fit.
 */
function minutesIn(items: Item[]): number[] {
  const events: number[] = [];
  const dues: number[] = [];
  for (const i of items) {
    if (isAllDayish(i)) continue;
    if (i.kind === 'event') {
      events.push(i.startMin);
      if (i.endMin !== null) events.push(i.endMin);
    } else {
      dues.push(i.startMin);
    }
  }
  return events.length > 0 ? events : dues;
}

