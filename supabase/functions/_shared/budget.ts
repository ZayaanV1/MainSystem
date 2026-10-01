/**
 * The shared-key budget, for every model call rather than one of them.
 *
 * THE BUG THIS FIXES
 *
 * The policy was written down and half-implemented. `chat` was capped at 40
 * calls a day while the other paths on the same key — the daily briefing, the
 * task breakdown, the syllabus import and, at the time, food parsing — had no
 * guard at all. Most of the paths on this key were unbounded, and the one that
 * was bounded was the convenience.
 *
 * So the reserve protected nothing: one busy account could exhaust the shared
 * key for every account, and the chatbot politely declined to spend a quota
 * that was already gone.
 *
 * WHY THE CAPS DIFFER
 *
 * They are ordered by how often each path is legitimately needed. Asking a
 * question is frequent; breaking down a task is occasional; importing a
 * syllabus is a once-a-term action with a large and expensive input. A single
 * number across all of them would either starve the frequent ones or fail to
 * constrain anything.
 *
 * WHO IS EXEMPT
 *
 * An account supplying its own key is not competing with anyone for a shared
 * pool, so no cap applies to it. That is the whole point of the setting.
 */

export type AiKind = 'chat' | 'summary' | 'breakdown' | 'syllabus';

const envNumber = (name: string, fallback: number): number => {
  const raw = Deno.env.get(name);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Per-day, per-account ceilings.
 *
 * Every one is overridable by environment variable, because these are policy
 * rather than physics — they are not derived from Google's published limits,
 * which change, are per-model, and are not visible from here. A number
 * inferred from them would be a guess wearing the costume of a fact.
 */
export function caps(): Record<AiKind, number> {
  return {
    chat: envNumber('CHAT_CALLS_PER_DAY', 40),
    // Fires on opening the app, but is fingerprint-cached, so a day of normal
    // use costs a handful. The cap is here to bound a pathological loop.
    summary: envNumber('SUMMARY_CALLS_PER_DAY', 12),
    breakdown: envNumber('BREAKDOWN_CALLS_PER_DAY', 20),
    // Large input, expensive, and needed a few times a term at most.
    syllabus: envNumber('SYLLABUS_CALLS_PER_DAY', 10),
  };
}

export interface BudgetVerdict {
  allowed: boolean;
  /** Calls left after this one, when it is allowed. */
  remaining: number;
  limit: number;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Whether this account may make another call of this kind today.
 *
 * Read-only. The increment is deliberately a separate call, made only once a
 * request actually reaches the model — checking and counting in one step bills
 * an account for calls that were refused, which then compounds: a user who
 * hits the wall keeps being charged for hitting it.
 */
export async function checkBudget(
  db: Db,
  userId: string,
  kind: AiKind,
  localDay: string,
  ownKey: boolean,
): Promise<BudgetVerdict> {
  const limit = caps()[kind];

  // Paying its own way, so the shared reserve is irrelevant.
  if (ownKey) return { allowed: true, remaining: Number.POSITIVE_INFINITY, limit };

  const { data, error } = await db
    .from('ai_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('local_day', localDay)
    .eq('kind', kind)
    .maybeSingle();

  /*
   * A failed read fails OPEN, and that is a deliberate trade rather than an
   * oversight. Refusing to read a syllabus because the usage table could not
   * be read would break the app's job to protect a quota, on the evidence
   * of a query that did not work. The cap is a cost control, not a safety
   * control, and a cost control should not take the product down with it.
   */
  if (error) return { allowed: true, remaining: limit, limit };

  const used = (data?.count as number | undefined) ?? 0;
  return { allowed: used < limit, remaining: Math.max(0, limit - used - 1), limit };
}

/** Records one call. Called only after the model has actually been reached. */
export async function recordUse(
  db: Db,
  userId: string,
  kind: AiKind,
  localDay: string,
  ownKey: boolean,
): Promise<void> {
  // Nothing to meter: this account is not drawing on the shared pool.
  if (ownKey) return;
  await db.rpc('record_ai_use', { p_user_id: userId, p_local_day: localDay, p_kind: kind });
}

/**
 * The sentence shown when a path stands down.
 *
 * Says what happened and when it resets, does not apologise, and says that the
 * rest of the app is unaffected — a limit with no stated scope reads as the
 * app being broken.
 */
export function standDownMessage(_kind: AiKind): string {
  return 'That is all the AI help for today. It resets at midnight. Everything else works as usual.';
}
