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

import { formatDay, type DayKey } from './time.ts';
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
 * Minimal shape of the database handle this module needs. Declared structurally
 * rather than importing the Supabase client type, so the builder can be tested
 * with a plain object and never needs a live connection.
 */
export interface DigestDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/**
 * Gathers the content sections of the digest.
 *
 * Phase 1 fills this in: assignments due within `assignment_window_days` with
 * overdue called out first, events within `event_window_days`, and today's
 * uncompleted checklist items. Until those tables exist it correctly returns
 * nothing, and the empty-state message below is what gets sent.
 */
export async function collectSections(
  _db: DigestDb,
  _userId: string,
  _settings: DigestSettings,
  _localDay: DayKey,
): Promise<DigestSection[]> {
  return [];
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
