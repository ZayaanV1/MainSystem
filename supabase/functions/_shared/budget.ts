/**
 * The shared-key budget, for every model call rather than one of them.
 *
 * THE FIRST BUG THIS FIXED
 *
 * The policy was written down and half-implemented. `chat` was capped at 40
 * calls a day while the other paths on the same key (the daily briefing, the
 * task breakdown, the syllabus import and, at the time, food parsing) had no
 * guard at all. Most of the paths on this key were unbounded, and the one that
 * was bounded was the convenience.
 *
 * THE SECOND (22 Oct 2026 audit)
 *
 * The limit was checked, the model was called, and only then was the use
 * counted. Requests sent together all read "0 used" and all went through, so a
 * script, rather than a patient person, could spend the shared key in one
 * burst. A slot is now RESERVED before the call, in one statement
 * (reserve_ai_use, migration 0045), and given back if the call produced
 * nothing, so hitting a wall still never costs a question.
 *
 * WHY THE CAPS DIFFER
 *
 * They are ordered by how often each path is legitimately needed. Asking a
 * question is frequent; breaking down a task is occasional; importing a
 * syllabus is a once-a-term action with a large and expensive input. A single
 * number across all of them would either starve the frequent ones or fail to
 * constrain anything.
 *
 * TWO LIMITS
 *
 * Per account, and across every account on the shared key. Limits are per
 * account, so many accounts add up; the shared ceiling is the one guard
 * against a flood of sign-ups spending the pool before real people can.
 *
 * WHO IS EXEMPT
 *
 * An account supplying its own key is not competing with anyone for a shared
 * pool, so neither limit applies to it, and its use is not counted.
 */

export type AiKind = 'chat' | 'summary' | 'breakdown' | 'syllabus' | 'guide' | 'embed' | 'feed';

// Reached through globalThis so this file type-checks in the app's own build as
// well as under Deno: its tests live in src/ beside the code they cover.
const envRead = (name: string): string | undefined =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);

const envNumber = (name: string, fallback: number): number => {
  const raw = envRead(name);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Per-day, per-account ceilings.
 *
 * Every one is overridable by environment variable, because these are policy
 * rather than physics: they are not derived from Google's published limits,
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
    // Also reads a whole PDF, but of one assignment and only on request.
    guide: envNumber('GUIDE_CALLS_PER_DAY', 8),
    // Abood remembers things by embedding them: one call to look a memory up
    // per question and one per fact learned. Cheap, but on the same shared key
    // and until now not counted at all.
    embed: envNumber('EMBED_CALLS_PER_DAY', 150),
    // Not a model call: the server fetching a calendar address someone typed.
    // Counted here because it is the same kind of shared, abusable resource.
    feed: envNumber('FEED_FETCHES_PER_DAY', 30),
  };
}

/**
 * The sum across every account on the shared key: this many accounts' worth of
 * the per-account cap. Sized so the accounts that exist today never meet it and
 * a flood of new ones does.
 */
export function globalCaps(): Record<AiKind, number> {
  const accounts = envNumber('AI_GLOBAL_ACCOUNT_BUDGET', 25);
  const per = caps();
  return Object.fromEntries(
    (Object.keys(per) as AiKind[]).map((k) => [k, per[k] * accounts]),
  ) as Record<AiKind, number>;
}

export interface Reservation {
  allowed: boolean;
  /** Calls left after this one, when it is allowed. */
  remaining: number;
  limit: number;
  /** Why it was refused: this account's own limit, or the shared ceiling. */
  denied?: 'account' | 'shared';
  /** True when a slot was actually taken and can be given back. */
  held: boolean;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Take a slot for one call, or find out there is none.
 *
 * Fails OPEN when the reservation itself cannot be made. Refusing to read a
 * syllabus because the usage table could not be reached would take the product
 * down to protect a quota, on the evidence of a query that did not work. The
 * cap is a cost control, not a safety control, and a cost control should not
 * take the product down with it.
 */
export async function reserve(
  db: Db,
  userId: string,
  kind: AiKind,
  localDay: string,
  ownKey: boolean,
): Promise<Reservation> {
  const limit = caps()[kind];

  // Paying its own way, so the shared reserve is irrelevant and nothing is counted.
  if (ownKey) return { allowed: true, remaining: Number.POSITIVE_INFINITY, limit, held: false };

  const { data, error } = await db.rpc('reserve_ai_use', {
    p_user_id: userId,
    p_local_day: localDay,
    p_kind: kind,
    p_limit: limit,
    p_global_limit: globalCaps()[kind],
  });

  if (error || typeof data !== 'number') return { allowed: true, remaining: limit, limit, held: false };
  if (data === -1) return { allowed: false, remaining: 0, limit, denied: 'account', held: false };
  if (data === -2) return { allowed: false, remaining: 0, limit, denied: 'shared', held: false };
  return { allowed: true, remaining: Math.max(0, limit - data), limit, held: true };
}

/** Give a slot back: the call never produced anything. A no-op for a slot that was never held. */
export async function release(
  db: Db,
  userId: string,
  kind: AiKind,
  localDay: string,
  reservation: Reservation,
): Promise<void> {
  if (!reservation.held) return;
  await db.rpc('release_ai_use', { p_user_id: userId, p_local_day: localDay, p_kind: kind });
}

/**
 * A yes-or-no for a cheap call that should be counted and never given back,
 * such as an embedding. Said as a function so the code that makes the call
 * needs to know nothing about budgets.
 */
export function meterFor(
  db: Db,
  userId: string,
  kind: AiKind,
  localDay: string,
  ownKey: boolean,
): () => Promise<boolean> {
  return async () => (await reserve(db, userId, kind, localDay, ownKey)).allowed;
}

/**
 * The sentence shown when a path stands down.
 *
 * Says what happened and when it resets, does not apologise, and says that the
 * rest of the app is unaffected: a limit with no stated scope reads as the
 * app being broken. A refusal by the shared ceiling says so and points at the
 * way out that always works, an account's own key.
 */
export function standDownMessage(_kind: AiKind, denied: 'account' | 'shared' = 'account'): string {
  if (denied === 'shared') {
    return 'The shared AI allowance is used up for today. It resets at midnight, or you can add your own key in Settings. Everything else works as usual.';
  }
  return 'That is all the AI help for today. It resets at midnight. Everything else works as usual.';
}
