/**
 * Builds the morning digest.
 *
 * Knows nothing about how the message is delivered. Produces an
 * OutboundMessage; the delivery layer decides where it goes.
 *
 * PHASE 0 SCOPE: there are no assignment, event or checklist tables yet — they
 * arrive in Phase 1, after the push proof, per the working agreement. So this
 * builder currently returns the empty digest on every run.
 *
 * That is not a placeholder. "Nothing due" is a real, specified code path:
 *
 *   > If nothing is due, send a short non-nagging message rather than nothing
 *   > — silence is indistinguishable from a broken pipeline.
 *
 * Phase 0 therefore exercises exactly the branch that is hardest to notice
 * being broken. When Phase 1 lands, `collectSections` gains its queries and
 * nothing else in this file changes.
 */

import {
  addDays,
  daysBetween,
  endOfDayUTC,
  formatDay,
  localDayKey,
  startOfDayUTC,
  type DayKey,
} from './time.ts';
import { dueOn, refillStatus, type ChecklistItem } from './checklist.ts';
import type { OutboundMessage } from './types.ts';

export interface DigestSection {
  heading: string;
  items: string[];
}

export interface DigestSettings {
  timezone: string;
  assignment_window_days: number;
  event_window_days: number;
}

/**
 * The database handle.
 *
 * Deliberately untyped. The obvious alternative — importing SupabaseClient —
 * would drag an `npm:` specifier into this module, and this module has to stay
 * importable by the browser test runner so `renderDigest` can be unit-tested
 * without a network or a Deno runtime.
 *
 * The previous attempt here described the client's shape structurally, which
 * looked safer and was not: PostgrestFilterBuilder is thenable but not a
 * Promise, so the two types never matched and the whole function failed to
 * typecheck under Deno. Real query typing arrives in Phase 1 at the call sites,
 * where there are actual queries to type.
 */
// deno-lint-ignore no-explicit-any
export type DigestDb = any;

/**
 * Gathers the content sections of the digest.
 *
 * Order is the message: overdue first, because it is the thing most likely to
 * be forgotten and least likely to be surfaced anywhere else; then what is due
 * inside the window; then events; then what is left on today's checklist.
 *
 * A section with nothing in it is omitted entirely rather than rendered empty.
 * "Overdue: none" is a line about failure that did not need writing.
 */
export async function collectSections(
  db: DigestDb,
  userId: string,
  settings: DigestSettings,
  localDay: DayKey,
): Promise<DigestSection[]> {
  const tz = settings.timezone;
  const dayStart = startOfDayUTC(localDay, tz).toISOString();
  const assignmentEnd = endOfDayUTC(addDays(localDay, settings.assignment_window_days), tz).toISOString();
  const eventEnd = endOfDayUTC(addDays(localDay, settings.event_window_days), tz).toISOString();

  const [assignments, events, items, completions] = await Promise.all([
    db
      .from('assignments')
      .select('title, due_at, course_id')
      .eq('user_id', userId)
      .neq('status', 'done')
      .not('due_at', 'is', null)
      .lte('due_at', assignmentEnd)
      .order('due_at', { ascending: true }),

    db
      .from('events')
      .select('title, starts_at, kind')
      .eq('user_id', userId)
      .gte('starts_at', dayStart)
      .lte('starts_at', eventEnd)
      .order('starts_at', { ascending: true }),

    db.from('checklist_items').select('*').eq('user_id', userId).eq('active', true),

    db
      .from('checklist_completions')
      .select('item_id')
      .eq('user_id', userId)
      .eq('local_day', localDay),
  ]);

  const sections: DigestSection[] = [];

  const due = (assignments.data ?? []) as { title: string; due_at: string }[];
  const overdue = due.filter((a) => a.due_at < dayStart);
  const upcoming = due.filter((a) => a.due_at >= dayStart);

  if (overdue.length) {
    sections.push({
      heading: 'Overdue',
      items: overdue.map((a) => `${a.title} — ${relativeDay(a.due_at, localDay, tz)}`),
    });
  }

  if (upcoming.length) {
    sections.push({
      heading: `Due in the next ${settings.assignment_window_days} days`,
      items: upcoming.map((a) => `${a.title} — ${relativeDay(a.due_at, localDay, tz)}`),
    });
  }

  const upcomingEvents = (events.data ?? []) as { title: string; starts_at: string }[];
  if (upcomingEvents.length) {
    sections.push({
      heading: `Coming up in ${settings.event_window_days} days`,
      items: upcomingEvents.map((e) => `${e.title} — ${relativeDay(e.starts_at, localDay, tz)}`),
    });
  }

  const doneToday = new Set(
    ((completions.data ?? []) as { item_id: string }[]).map((c) => c.item_id),
  );
  const outstanding = dueOn((items.data ?? []) as ChecklistItem[], localDay).filter(
    (i) => !doneToday.has(i.id),
  );

  if (outstanding.length) {
    sections.push({
      heading: 'Today',
      items: outstanding.map((i) => {
        const refill = refillStatus(i);
        return refill.needsRefill && refill.label ? `${i.title} (${refill.label})` : i.title;
      }),
    });
  }

  return sections;
}

/**
 * How a date reads relative to the digest's own day.
 *
 * Named days rather than counted ones wherever a name exists: "tomorrow" is
 * read at a glance, "in 1 day" has to be decoded. Lateness is stated as a fact
 * and never as an accusation.
 */
function relativeDay(iso: string, localDay: DayKey, tz: string): string {
  const day = localDayKey(new Date(iso), tz);
  const delta = daysBetween(localDay, day);

  if (delta < 0) {
    const late = Math.abs(delta);
    return `${late} ${late === 1 ? 'day' : 'days'} ago`;
  }
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta <= 6) return formatDay(day, tz);
  return `${formatDay(day, tz)}, in ${delta} days`;
}

/**
 * Turns sections into the message that actually gets sent.
 *
 * Copy voice: plain, active, sentence case. No emoji, no exclamation marks, no
 * praise and no lament. An empty day reads as a fact, not a verdict — the
 * whole point is that a bad week must not make this thing punishing to open.
 */
export function renderDigest(
  localDay: DayKey,
  sections: DigestSection[],
  timezone: string,
  appUrl?: string,
): OutboundMessage {
  const title = formatDay(localDay, timezone);

  if (sections.length === 0) {
    return {
      title,
      body: 'Nothing due.',
      deepLink: appUrl,
    };
  }

  const body = sections
    .map((s) => [s.heading, ...s.items.map((i) => `- ${i}`)].join('\n'))
    .join('\n\n');

  return { title, body, deepLink: appUrl };
}

/** Convenience wrapper: gather, then render. */
export async function buildDigest(
  db: DigestDb,
  userId: string,
  settings: DigestSettings,
  localDay: DayKey,
  appUrl?: string,
): Promise<OutboundMessage> {
  const sections = await collectSections(db, userId, settings, localDay);
  return renderDigest(localDay, sections, settings.timezone, appUrl);
}

/**
 * The "send test digest now" payload.
 *
 * Deliberately distinguishable from a real digest on the phone. A test that
 * looks identical to the real thing cannot be used to diagnose anything.
 */
export function renderTestMessage(localDay: DayKey, timezone: string, appUrl?: string): OutboundMessage {
  return {
    title: 'Test notification',
    body: `Delivery is working. Sent ${formatDay(localDay, timezone)}.`,
    deepLink: appUrl,
  };
}
