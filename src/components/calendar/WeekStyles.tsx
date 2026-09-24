import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CALENDAR_STYLES, type CalendarStyle } from '../../lib/calendarStyle';
import { durationLabel, freeGaps } from '../../lib/blocks';
import { effortMinutes, type DayGroup } from '../../lib/week';
import type { Assignment, Course } from '../../lib/planner';
import type { DayKey } from '../../lib/time';
import {
  buildDay,
  clock,
  dayNames,
  effortLabel,
  spansOf,
  tint,
  type DueItem,
  type EventItem,
  type Item,
} from './items';

/**
 * The Week view's block styles that read as a list: Bubble, Ticket and
 * Ledger. Hours is a grid and lives in its own file.
 *
 * All three draw from buildDay, so they disagree only about appearance.
 * Every deadline keeps its done toggle, its written urgency and a tap to open
 * it, in every style — a style that made work harder to tick off would be a
 * worse week view wearing a nicer coat.
 */

export interface StyleProps {
  days: DayGroup[];
  today: DayKey;
  now: Date;
  courseFor: (id: string | null) => Course | undefined;
  progressFor: (id: string) => { done: number; total: number } | null;
  onToggle: (a: Assignment) => void;
  onOpen: (a: Assignment) => void;
  /** Name each event's calendar only when there is more than one to tell apart. */
  showSource: boolean;
}

/* ============================================================================
   The picker
   ========================================================================= */

export function StylePicker({
  value,
  onChange,
}: {
  value: CalendarStyle;
  onChange: (s: CalendarStyle) => void;
}) {
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // A radiogroup moves with the arrow keys, which is what a screen reader
  // user has been told to expect by the role.
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + CALENDAR_STYLES.length) % CALENDAR_STYLES.length;
    onChange(CALENDAR_STYLES[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Calendar style" className="style-seg">
      {CALENDAR_STYLES.map((s, i) => {
        const on = s.value === value;
        return (
          <button
            type="button"
            key={s.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={s.hint}
            onClick={() => onChange(s.value)}
            onKeyDown={(e) => onKey(e, i)}
            className="style-opt"
          >
            {on && (
              <motion.span
                layoutId="calendar-style-lit"
                className="style-opt-lit"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
              />
            )}
            <Glyph style={s.value} />
            <span>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A drawn miniature of each style, in the text colour so it follows the pill. */
function Glyph({ style }: { style: CalendarStyle }) {
  const common = { width: 18, height: 14, viewBox: '0 0 18 14', 'aria-hidden': true } as const;
  switch (style) {
    case 'rail':
      return (
        <svg {...common}>
          <path d="M3 1v12" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
          <circle cx="3" cy="3" r="1.8" fill="currentColor" />
          <circle cx="3" cy="10" r="1.8" fill="currentColor" />
          <rect x="7" y="2" width="10" height="2" rx="1" fill="currentColor" />
          <rect x="7" y="9" width="7" height="2" rx="1" fill="currentColor" />
        </svg>
      );
    case 'bubble':
      return (
        <svg {...common}>
          <rect x="1" y="0.5" width="16" height="5" rx="2.5" fill="currentColor" opacity="0.55" />
          <rect x="1" y="7" width="16" height="6.5" rx="3" fill="currentColor" />
        </svg>
      );
    case 'hours':
      return (
        <svg {...common}>
          <path d="M1 1h16M1 5h16M1 9h16M1 13h16" stroke="currentColor" strokeWidth="0.8" opacity="0.45" />
          <rect x="3" y="2" width="6" height="6" rx="1.5" fill="currentColor" />
          <rect x="10" y="6" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.7" />
        </svg>
      );
    case 'ticket':
      return (
        <svg {...common}>
          <path
            d="M2.5 1.5h3.2a1.3 1.3 0 0 0 2.6 0h7.2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8.3a1.3 1.3 0 0 0-2.6 0H2.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M7 4.5v5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.2 1.2" />
        </svg>
      );
    case 'ledger':
      return (
        <svg {...common}>
          <rect x="1" y="1" width="16" height="1.8" fill="currentColor" />
          <rect x="1" y="5.5" width="4" height="2.5" fill="currentColor" />
          <rect x="7" y="6" width="10" height="1.4" fill="currentColor" opacity="0.6" />
          <rect x="1" y="10.5" width="4" height="2.5" fill="currentColor" />
          <rect x="7" y="11" width="7" height="1.4" fill="currentColor" opacity="0.6" />
        </svg>
      );
  }
}

/* ============================================================================
   Shared pieces
   ========================================================================= */

export function DueToggle({ a, onToggle }: { a: Assignment; onToggle: () => void }) {
  const done = a.status === 'done';
  return (
    <button
      type="button"
      className="due-toggle"
      aria-pressed={done}
      aria-label={done ? `Mark ${a.title} not done` : `Mark ${a.title} done`}
      onClick={onToggle}
    >
      <span aria-hidden>
        {done && (
          <svg viewBox="0 0 12 12" className="h-3 w-3">
            <path
              d="M2.5 6.2 L4.8 8.5 L9.5 3.8"
              fill="none"
              stroke="var(--ink-900)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}

/** The facts under a deadline's title, identical in every style. */
export function DueFacts({ item }: { item: DueItem }) {
  const a = item.assignment;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="type-caption" style={{ color: `var(${item.urgency.colourVar})` }}>
        {item.urgency.label}
      </span>
      {item.course && <span className="tag type-caption">{item.course.code ?? item.course.name}</span>}
      {typeof a.weight_percent === 'number' && (
        <span className="tag type-caption">{a.weight_percent}% of grade</span>
      )}
      {item.steps && (
        <span className="type-caption text-text-mid">
          {item.steps.done} of {item.steps.total} steps
        </span>
      )}
    </span>
  );
}

function DayHead({ day, isToday, minutes }: { day: DayKey; isToday: boolean; minutes: number }) {
  const n = dayNames(day);
  return (
    <header className="day-head" data-today={isToday || undefined}>
      <span className="day-head-date">{n.date}</span>
      <span className="flex flex-col">
        <span className="type-label text-text-hi">{isToday ? `Today · ${n.weekday}` : n.weekday}</span>
        <span className="type-caption text-text-low">{n.month}</span>
      </span>
      <span aria-hidden className="day-head-rule" />
      {minutes > 0 && <span className="tag type-caption">{effortLabel(minutes)} of work</span>}
    </header>
  );
}

/** Custom properties, typed. */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Stagger({ i, children, className = '' }: { i: number; children: ReactNode; className?: string }) {
  return (
    <li className={`blk-enter ${className}`} style={vars({ '--i': i })}>
      {children}
    </li>
  );
}

/** Items interleaved with the free time between them. */
function withGaps(items: Item[]): (Item | { kind: 'gap'; id: string; minutes: number })[] {
  const gaps = new Map(freeGaps(spansOf(items), 30).map((g) => [g.after, g.minutes]));
  const out: (Item | { kind: 'gap'; id: string; minutes: number })[] = [];
  for (const it of items) {
    out.push(it);
    const m = gaps.get(it.id);
    if (m) out.push({ kind: 'gap', id: `gap-${it.id}`, minutes: m });
  }
  return out;
}

function Week({
  props,
  render,
}: {
  props: StyleProps;
  render: (items: Item[], group: DayGroup, isToday: boolean) => ReactNode;
}) {
  // A bubble or a ticket stretched across a desktop is a banner, not a block.
  // Held to a reading width; the hour grid and the ledger use the full frame.
  return (
    <div className="flex max-w-3xl flex-col gap-8 px-4 pb-4">
      {props.days.map((group) => {
        const isToday = group.day === props.today;
        const items = buildDay(group, props.courseFor, props.progressFor, props.now);
        return (
          <section key={group.day} aria-label={dayNames(group.day).weekday}>
            <DayHead day={group.day} isToday={isToday} minutes={effortMinutes(group)} />
            {items.length > 0 && render(items, group, isToday)}
          </section>
        );
      })}
    </div>
  );
}

/* ============================================================================
   Bubble
   ========================================================================= */

export function BubbleWeek(props: StyleProps) {
  return (
    <Week
      props={props}
      render={(items) => (
        <ol className="flex flex-col gap-2">
          {withGaps(items).map((it, i) =>
            it.kind === 'gap' ? (
              <li key={it.id} className="gap-free type-note">
                {durationLabel(it.minutes)} free
              </li>
            ) : (
              <Stagger key={it.id} i={i}>
                {it.kind === 'event' ? (
                  <BubbleEvent item={it} showSource={props.showSource} />
                ) : (
                  <BubbleDue
                    item={it}
                    onToggle={() => props.onToggle(it.assignment)}
                    onOpen={() => props.onOpen(it.assignment)}
                  />
                )}
              </Stagger>
            ),
          )}
        </ol>
      )}
    />
  );
}

function BubbleEvent({ item, showSource }: { item: EventItem; showSource: boolean }) {
  const c = clock(item.start);
  const until = item.end && !item.allDay ? clock(item.end) : null;
  const codeInHeadline = item.read.code !== null;

  return (
    <div className="bubble-row">
      <div className="bubble-time blk-num">
        {item.allDay ? (
          <small>All day</small>
        ) : (
          <>
            <b>{c.hm}</b>
            <small>{c.suffix}</small>
          </>
        )}
      </div>
      <div
        className="bubble"
        data-block
        data-now={item.state === 'now' || undefined}
        data-past={item.state === 'past' || undefined}
        style={tint(item.course, { '--mins': item.mins ?? 52 })}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="type-label font-semibold text-text-hi">{item.headline}</span>
          {item.state === 'now' ? (
            <span className="now-pill shrink-0">Now</span>
          ) : (
            item.course &&
            !codeInHeadline && <span className="tag type-caption shrink-0">{item.course.code ?? item.course.name}</span>
          )}
        </div>
        {item.detail && <p className="type-note text-text-mid">{item.detail}</p>}
        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 type-caption text-text-mid">
          {until && <span>to {until.hm} {until.suffix}</span>}
          {item.mins !== null && <span>{durationLabel(item.mins)}</span>}
          {item.read.section && <span>{item.read.section}</span>}
          {item.place && <span>{item.place}</span>}
          {showSource && item.event.source && <span>{item.event.source}</span>}
        </p>
        {item.progress !== null && (
          <span aria-hidden className="bubble-progress" style={vars({ '--p': item.progress })} />
        )}
        {item.state === 'past' && <span className="sr-only">Finished.</span>}
      </div>
    </div>
  );
}

function BubbleDue({ item, onToggle, onOpen }: { item: DueItem; onToggle: () => void; onOpen: () => void }) {
  const c = clock(item.at);
  return (
    <div className="bubble-row">
      <div className="bubble-time blk-num">
        {item.timed ? (
          <>
            <b>{c.hm}</b>
            <small>{c.suffix}</small>
          </>
        ) : (
          <small>By end of day</small>
        )}
      </div>
      <div className="bubble-due" data-block style={tint(item.course)}>
        <span
          aria-hidden
          className="bubble-due-bar"
          style={{ backgroundColor: `var(${item.urgency.colourVar})` }}
        />
        <DueToggle a={item.assignment} onToggle={onToggle} />
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-[var(--tap)] min-w-0 flex-1 flex-col justify-center py-3 pr-4 text-left"
        >
          <span className="type-caption text-text-low">Due</span>
          <span
            className={`type-label font-semibold ${item.assignment.status === 'done' ? 'text-text-low line-through' : 'text-text-hi'}`}
          >
            {item.assignment.title}
          </span>
          <DueFacts item={item} />
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
   Ticket
   ========================================================================= */

export function TicketWeek(props: StyleProps) {
  return (
    <Week
      props={props}
      render={(items) => (
        <ol className="flex flex-col gap-3">
          {items.map((it, i) => (
            <Stagger key={it.id} i={i}>
              {it.kind === 'event' ? (
                <TicketEvent item={it} />
              ) : (
                <TicketDue
                  item={it}
                  onToggle={() => props.onToggle(it.assignment)}
                  onOpen={() => props.onOpen(it.assignment)}
                />
              )}
            </Stagger>
          ))}
        </ol>
      )}
    />
  );
}

function TicketEvent({ item }: { item: EventItem }) {
  const c = clock(item.start);
  // What kind of thing this is, as specifically as the data allows: the
  // meeting type from a timetable, else the course, else the calendar it
  // came from. "Event" only when nothing better is known.
  const kicker = item.read.type ?? item.course?.code ?? item.event.source ?? 'Event';

  return (
    <div className="ticket-wrap" data-now={item.state === 'now' || undefined}>
      <article
        className="ticket"
        data-block
        data-now={item.state === 'now' || undefined}
        data-past={item.state === 'past' || undefined}
        style={tint(item.course)}
      >
        <div className="ticket-stub blk-num">
          {item.allDay ? (
            <>
              <b>All</b>
              <small>day</small>
            </>
          ) : (
            <>
              <b>{c.hm}</b>
              <small>{c.suffix}</small>
              {item.mins !== null && <small className="mt-1">{durationLabel(item.mins)}</small>}
            </>
          )}
        </div>
        <div className="ticket-body">
          <div className="ticket-kicker">
            <span className="truncate">{kicker}</span>
            {item.state === 'now' ? (
              <span className="now-pill">Now</span>
            ) : (
              item.read.section && <span className="blk-num">{item.read.section.replace('Section ', 'Sec ')}</span>
            )}
          </div>
          <div className="ticket-title">{item.headline}</div>
          {(item.detail || item.place) && (
            <div className="type-note truncate text-text-mid">
              {[item.detail, item.place].filter(Boolean).join(' · ')}
            </div>
          )}
          {item.state === 'past' && <span className="sr-only">Finished.</span>}
        </div>
      </article>
    </div>
  );
}

function TicketDue({ item, onToggle, onOpen }: { item: DueItem; onToggle: () => void; onOpen: () => void }) {
  const c = clock(item.at);
  return (
    <div className="ticket-wrap">
      <article className="ticket" data-block style={tint(item.course)}>
        <span
          aria-hidden
          className="ticket-bar"
          style={{ backgroundColor: `var(${item.urgency.colourVar})` }}
        />
        <div className="ticket-stub blk-num">
          <small>Due</small>
          {item.timed ? (
            <>
              <b>{c.hm}</b>
              <small>{c.suffix}</small>
            </>
          ) : (
            <small>End of day</small>
          )}
        </div>
        <div className="ticket-body">
          <div className="flex items-center gap-1">
            <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col text-left">
              <span className="ticket-kicker">
                <span className="truncate">{item.course?.code ?? 'Work'}</span>
              </span>
              <span
                className={`ticket-title ${item.assignment.status === 'done' ? 'text-text-low line-through' : ''}`}
              >
                {item.assignment.title}
              </span>
              <DueFacts item={item} />
            </button>
            <DueToggle a={item.assignment} onToggle={onToggle} />
          </div>
        </div>
      </article>
    </div>
  );
}

/* ============================================================================
   Ledger
   ========================================================================= */

export function LedgerWeek(props: StyleProps) {
  return (
    <div className="flex flex-col gap-10 px-4 pb-4">
      {props.days.map((group) => {
        const isToday = group.day === props.today;
        const items = buildDay(group, props.courseFor, props.progressFor, props.now);
        const longest = Math.max(60, ...items.map((i) => (i.kind === 'event' ? (i.mins ?? 0) : 0)));
        const n = dayNames(group.day);
        const minutes = effortMinutes(group);

        return (
          <section key={group.day} aria-label={n.weekday}>
            <header className="ledger-head" data-today={isToday || undefined}>
              <span className="ledger-head-num">{String(n.date).padStart(2, '0')}</span>
              <span className="flex items-end justify-between gap-3 pb-0.5">
                <span className="flex flex-col">
                  <span className="type-h2 text-text-hi">{isToday ? `Today, ${n.weekday}` : n.weekday}</span>
                  <span className="type-caption text-text-low">{n.month}</span>
                </span>
                {minutes > 0 && <span className="tag type-caption">{effortLabel(minutes)} of work</span>}
              </span>
            </header>
            {items.length > 0 && (
              <ol>
                {withGaps(items).map((it, i) =>
                  it.kind === 'gap' ? (
                    <li key={it.id} className="border-b border-ink-600 py-2 pl-24 type-note text-text-low">
                      {durationLabel(it.minutes)} free
                    </li>
                  ) : it.kind === 'event' ? (
                    <LedgerEvent key={it.id} i={i} item={it} longest={longest} showSource={props.showSource} />
                  ) : (
                    <LedgerDue
                      key={it.id}
                      i={i}
                      item={it}
                      onToggle={() => props.onToggle(it.assignment)}
                      onOpen={() => props.onOpen(it.assignment)}
                    />
                  ),
                )}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function LedgerEvent({
  item,
  i,
  longest,
  showSource,
}: {
  item: EventItem;
  i: number;
  longest: number;
  showSource: boolean;
}) {
  const c = clock(item.start);
  const until = item.end && !item.allDay ? clock(item.end) : null;
  const facts = [item.detail, item.read.section, item.place, showSource ? item.event.source : null].filter(Boolean);

  return (
    <li
      className="ledger-row blk-enter"
      data-block
      data-past={item.state === 'past' || undefined}
      style={tint(item.course, { '--i': i, '--frac': item.mins ? Math.min(1, item.mins / longest) : 0 })}
    >
      <div className="ledger-time blk-num">
        {item.allDay ? (
          <b>All day</b>
        ) : (
          <>
            <b>{c.hm}</b>
            <small>{c.suffix}</small>
            {until && <small>to {until.hm}</small>}
          </>
        )}
      </div>
      <div className="min-w-0">
        <div className="type-label font-semibold text-text-hi">{item.headline}</div>
        {facts.length > 0 && <div className="type-note text-text-mid">{facts.join(' · ')}</div>}
        {item.mins !== null && (
          <div className="flex items-center gap-2">
            <span aria-hidden className="ledger-length" />
            <span className="mt-2 type-caption text-text-low">{durationLabel(item.mins)}</span>
          </div>
        )}
        {item.state === 'past' && <span className="sr-only">Finished.</span>}
      </div>
      <div className="pt-1">
        {item.state === 'now' ? (
          <span className="now-pill">Now</span>
        ) : (
          item.course && <span className="ledger-code">{item.course.code ?? item.course.name}</span>
        )}
      </div>
    </li>
  );
}

function LedgerDue({
  item,
  i,
  onToggle,
  onOpen,
}: {
  item: DueItem;
  i: number;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const c = clock(item.at);
  return (
    <li className="ledger-row blk-enter" data-block style={tint(item.course, { '--i': i })}>
      <span aria-hidden className="ledger-bar" style={{ backgroundColor: `var(${item.urgency.colourVar})` }} />
      <div className="ledger-time blk-num">
        {item.timed ? (
          <>
            <b>{c.hm}</b>
            <small>{c.suffix} · due</small>
          </>
        ) : (
          <small>Due by end of day</small>
        )}
      </div>
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <span
          className={`type-label font-semibold ${item.assignment.status === 'done' ? 'text-text-low line-through' : 'text-text-hi'}`}
        >
          {item.assignment.title}
        </span>
        <DueFacts item={item} />
      </button>
      <DueToggle a={item.assignment} onToggle={onToggle} />
    </li>
  );
}
