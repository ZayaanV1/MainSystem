import { supabase } from './supabase';
import { daysBetween, type DayKey } from './time';

/**
 * A goal: a number to reach by a date. "Read Leviathan, 9 of 15 chapters,
 * by 6 November" (migration 0040).
 *
 * Progress is a count the person moves with one tap, never a run of days.
 * Nothing resets, nothing is "per day", and a goal reached stays reached, so
 * it cannot turn into a streak by accident (rule 3).
 */

export interface Goal {
  id: string;
  title: string;
  unit: string;
  have: number;
  target: number;
  by_day: DayKey | null;
}

const COLUMNS = 'id, title, unit, have, target, by_day';

/**
 * Above this many the bar is one fill rather than a segment per unit: twenty
 * four segments still read as countable at a widget's width, sixty do not.
 */
export const SEGMENT_LIMIT = 24;

export interface GoalProgress {
  /** 0 to 1. */
  share: number;
  left: number;
  reached: boolean;
  /** Whole days to the by-date, never negative; null without one. */
  daysLeft: number | null;
  /** One flag per unit when the target is small enough to count, else null. */
  segments: boolean[] | null;
}

export function goalProgress(goal: Goal, today: DayKey): GoalProgress {
  const have = Math.min(goal.have, goal.target);
  return {
    share: goal.target > 0 ? have / goal.target : 0,
    left: Math.max(0, goal.target - have),
    reached: have >= goal.target,
    daysLeft: goal.by_day ? Math.max(0, daysBetween(today, goal.by_day)) : null,
    segments: goal.target <= SEGMENT_LIMIT ? Array.from({ length: goal.target }, (_, i) => i < have) : null,
  };
}

/** Clamp a typed count into what the table accepts. */
export function clampGoal(fields: { have: number; target: number }): { have: number; target: number } {
  const target = Math.max(1, Math.min(100000, Math.round(Number.isFinite(fields.target) ? fields.target : 1)));
  const have = Math.max(0, Math.min(target, Math.round(Number.isFinite(fields.have) ? fields.have : 0)));
  return { have, target };
}

export async function loadGoals(): Promise<{ goals: Goal[]; error: string | null }> {
  const { data, error } = await supabase.from('goals').select(COLUMNS).order('created_at').limit(200);
  if (error) return { goals: [], error: 'Couldn’t load your goals.' };
  return { goals: (data ?? []) as Goal[], error: null };
}

export async function createGoal(
  userId: string,
  fields: Omit<Goal, 'id'>,
): Promise<{ goal: Goal | null; error: string | null }> {
  const counts = clampGoal(fields);
  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: userId, title: fields.title.trim() || 'Goal', unit: fields.unit.trim(), by_day: fields.by_day, ...counts })
    .select(COLUMNS)
    .single();
  if (error || !data) return { goal: null, error: 'Couldn’t save the goal. Try again.' };
  return { goal: data as Goal, error: null };
}

export async function updateGoal(id: string, fields: Partial<Omit<Goal, 'id'>>): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { ...fields };
  if (fields.title !== undefined) patch.title = fields.title.trim() || 'Goal';
  if (fields.unit !== undefined) patch.unit = fields.unit.trim();
  const { error } = await supabase.from('goals').update(patch).eq('id', id);
  return { error: error ? 'Couldn’t save that change to the goal. Try again.' : null };
}

export async function deleteGoal(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('goals').delete().eq('id', id);
  return { error: error ? 'Couldn’t remove the goal. Try again.' : null };
}
