import { supabase } from './supabase';
import { enqueue } from './outbox';
import { recentDays, type ChecklistItem } from './checklist';
import { todayKey, type DayKey } from './time';

/**
 * Data access for the planner.
 *
 * Reads go straight to Supabase. Writes go through the IndexedDB outbox, so a
 * tap made on the metro is durable on disk before the interface claims it
 * worked, and replays on reconnect.
 *
 * The one asymmetry worth knowing: the medication dose count is maintained by
 * a database trigger, not here. So after a completion syncs, the count has to
 * be re-read rather than guessed at locally — which is why `loadToday` is
 * called again when the outbox drains.
 */

export interface InboxItem {
  id: string;
  body: string;
  source: string;
  created_at: string;
}

export interface Completion {
  item_id: string;
  local_day: DayKey;
}

export interface TodayData {
  items: ChecklistItem[];
  completions: Completion[];
  inbox: InboxItem[];
}

/** How many days of back-fill are offered. Bounded on purpose. */
export const BACKFILL_DAYS = 5;

export async function loadToday(today: DayKey = todayKey()): Promise<TodayData> {
  const window = recentDays(today, BACKFILL_DAYS);

  const [items, completions, inbox] = await Promise.all([
    supabase
      .from('checklist_items')
      .select(
        'id, title, recurrence, weekdays, interval_days, anchor_day, active, sort_order, tracks_doses, doses_remaining, doses_per_completion, refill_warning_days',
      )
      .eq('active', true)
      .order('sort_order'),

    supabase
      .from('checklist_completions')
      .select('item_id, local_day')
      .gte('local_day', window[0])
      .lte('local_day', window[window.length - 1]),

    supabase
      .from('inbox_items')
      .select('id, body, source, created_at')
      .is('triaged_at', null)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false }),
  ]);

  return {
    items: (items.data ?? []) as ChecklistItem[],
    completions: (completions.data ?? []) as Completion[],
    inbox: (inbox.data ?? []) as InboxItem[],
  };
}

/**
 * Quick capture.
 *
 * One field, no validation beyond "not blank", no course, no date, no type.
 * Every question asked here is a chance for the thought to evaporate before it
 * is recorded, so none are asked.
 */
export async function capture(userId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;

  await enqueue('inbox_items', 'insert', {
    user_id: userId,
    body: text,
    source: 'app',
  });
}

export async function dismissInboxItem(id: string): Promise<void> {
  await enqueue('inbox_items', 'update', { dismissed_at: new Date().toISOString() }, { id });
}

/**
 * Check or uncheck an item for a given local day.
 *
 * Deleting the row rather than flagging it is what makes the dose trigger
 * symmetrical: an accidental tap costs nothing because unchecking hands the
 * dose straight back.
 *
 * `backfilled` is recorded for any day that is not today. It never surfaces in
 * the interface as a judgement — it exists so an export can tell the
 * difference, and nothing else reads it.
 */
export async function setCompletion(
  userId: string,
  itemId: string,
  day: DayKey,
  done: boolean,
  today: DayKey = todayKey(),
): Promise<void> {
  if (done) {
    await enqueue('checklist_completions', 'insert', {
      user_id: userId,
      item_id: itemId,
      local_day: day,
      backfilled: day !== today,
    });
  } else {
    await enqueue('checklist_completions', 'delete', {}, { item_id: itemId, local_day: day });
  }
}

/** Fast membership lookup for "was this item done on this day". */
export function completionKey(itemId: string, day: DayKey): string {
  return `${itemId}|${day}`;
}

export function completionSet(completions: Completion[]): Set<string> {
  return new Set(completions.map((c) => completionKey(c.item_id, c.local_day)));
}
