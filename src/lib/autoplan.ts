import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { activeTimezone } from './time';
import { replan, undoReplan, type AtRisk, type PlanBlockRow, type ReplanResult } from '../../supabase/functions/_shared/autoplan';

export type { PlanBlockRow, AtRisk };

/**
 * Autoplan in the app: the same replan the server runs, through the app's own
 * client (so RLS bounds it), re-run whenever the planner's data changes.
 *
 * Not through the outbox: blocks are derived, and a replan offline would plan
 * against a calendar it cannot see. Offline, the last plan stays on screen
 * and the error says so.
 */

export interface PlanState {
  blocks: PlanBlockRow[];
  atRisk: AtRisk[];
  unsized: number;
  disabled: boolean;
  /** The last replan moved something: said once, with undo. */
  moved: { message: string; undo: () => Promise<void> } | null;
  error: string | null;
}

const EMPTY: PlanState = { blocks: [], atRisk: [], unsized: 0, disabled: false, moved: null, error: null };

/** Re-plans when `dep` changes (a fresh load of the day), at most once a second. */
export function useAutoplan(userId: string | null, dep: unknown): PlanState & { refresh: () => void; clearMoved: () => void } {
  const [state, setState] = useState<PlanState>(EMPTY);
  const running = useRef(false);
  const again = useRef(false);

  const run = useCallback(async () => {
    if (!userId) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      const r: ReplanResult = await replan(supabase, userId, activeTimezone());
      const undo = r.undo;
      setState((s) => ({
        blocks: r.blocks,
        atRisk: r.atRisk,
        unsized: r.unsized,
        disabled: r.disabled,
        error: null,
        // Only a real move is worth a line: first placements are the plan appearing, not changing.
        moved:
          r.moved > 0 && undo
            ? {
                message: `Plan updated: ${r.moved} block${r.moved === 1 ? '' : 's'} moved to fit your calendar`,
                undo: async () => {
                  await undoReplan(supabase, userId, undo);
                  void run();
                },
              }
            : s.moved,
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: `The plan could not be updated: ${(e as Error).message}. It will try again next time this opens.` }));
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void run();
      }
    }
  }, [userId]);

  useEffect(() => {
    const t = setTimeout(() => void run(), 300);
    return () => clearTimeout(t);
  }, [run, dep]);

  return { ...state, refresh: () => void run(), clearMoved: () => setState((s) => ({ ...s, moved: null })) };
}

async function patchBlock(userId: string, id: string, patch: Partial<PlanBlockRow>): Promise<void> {
  const { error } = await supabase.from('planned_blocks').update(patch).eq('user_id', userId).eq('id', id);
  if (error) throw new Error(error.message);
}

export const blockDone = (userId: string, b: PlanBlockRow, minutes?: number) =>
  patchBlock(userId, b.id, { state: 'done', done_minutes: minutes ?? b.minutes });
export const blockSkip = (userId: string, b: PlanBlockRow) => patchBlock(userId, b.id, { state: 'skipped' });
export const blockPin = (userId: string, b: PlanBlockRow, pinned: boolean) => patchBlock(userId, b.id, { pinned });
export const blockRestore = (userId: string, b: PlanBlockRow) =>
  patchBlock(userId, b.id, { state: b.state, pinned: b.pinned, done_minutes: b.done_minutes });

/* ---- plan settings ------------------------------------------------------- */

export interface PlanSettings {
  study_hours: Record<string, [number, number]> | null;
  plan_off_days: string[];
  plan_day_cap: number;
  autoplan: boolean;
}

export async function loadPlanSettings(userId: string): Promise<PlanSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('study_hours, plan_off_days, plan_day_cap, autoplan')
    .eq('user_id', userId)
    .single();
  if (error) throw new Error(error.message);
  return data as PlanSettings;
}

export async function savePlanSettings(userId: string, patch: Partial<PlanSettings>): Promise<void> {
  const { error } = await supabase.from('app_settings').update(patch).eq('user_id', userId);
  if (error) throw new Error(error.message);
}
