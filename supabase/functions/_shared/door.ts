import { askAbood, learn } from './abood.ts';
import { geminiProvider } from './llm/gemini.ts';
import { groqProvider } from './llm/groq.ts';
import { withFallback } from './llm/chain.ts';
import { checkBudget, recordUse } from './budget.ts';
import { localDayKey } from './time.ts';

/**
 * A door into Abood from outside the app — Telegram, iMessage.
 *
 * Everything that happens after a message has been matched to an account:
 * the few commands (help, memory, forget), the budget, the transcript, the
 * answer, and learning from what was said. Each channel supplies only how to
 * send text back, so a new channel is a transport and nothing else, and the
 * rules — one transcript, one memory, one daily budget, changes confirmed in
 * the app only — cannot drift between doors.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

const env = (k: string): string => Deno.env.get(k) ?? '';
const APP_URL = env('APP_URL');
const MAX_MESSAGE = 2_000;

export type Via = 'telegram' | 'imessage';

/**
 * A reply as the separate texts a person would send.
 *
 * The model writes its messages with a blank line between them; each becomes
 * its own bubble. Costs nothing — it is the same reply, cut where the model
 * already chose to break it. Capped at four: anything past that joins the
 * last, because six texts in a row reads as spam, not as a friend.
 */
export function textsOf(reply: string, max = 4): string[] {
  const parts = reply
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (parts.length <= max) return parts.length ? parts : [reply.trim()];
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join(' ')];
}

export const HELP = [
  'Ask me anything about your work, classes or checklist, and I answer from what is in your planner.',
  '',
  'memory  what I remember about you',
  'forget  clear what I remember',
  'help  this message',
].join('\n');

export async function converse(opts: {
  admin: Admin;
  userId: string;
  text: string;
  via: Via;
  send: (text: string) => Promise<unknown>;
  typing?: () => Promise<unknown>;
}): Promise<void> {
  const { admin, userId, text, via, send, typing } = opts;

  // ---- commands ----------------------------------------------------------
  if (/^\/?help$/i.test(text)) {
    await send(HELP);
    return;
  }

  if (/^\/?memory$/i.test(text)) {
    const { data } = await admin
      .from('memory_facts')
      .select('fact')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    const facts = ((data ?? []) as { fact: string }[]).map((r) => `- ${r.fact}`);
    await send(
      facts.length
        ? `What I remember:\n${facts.join('\n')}\n\nYou can remove any of these in Settings, or send forget.`
        : 'Nothing yet. I pick things up as we talk — routines, preferences, what helps.',
    );
    return;
  }

  if (/^\/?forget(\s+yes)?$/i.test(text)) {
    // Two steps, because it cannot be undone.
    if (!/^\/?forget\s+yes$/i.test(text)) {
      await send('That clears everything I remember about you. Send "forget yes" to go ahead.');
      return;
    }
    const { count } = await admin
      .from('memory_facts')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    await send(count ? `Cleared ${count} ${count === 1 ? 'thing' : 'things'}.` : 'There was nothing to clear.');
    return;
  }

  // ---- a question --------------------------------------------------------
  const message = text.slice(0, MAX_MESSAGE);

  const { data: settings } = await admin
    .from('app_settings')
    .select('gemini_api_key, groq_api_key, timezone')
    .eq('user_id', userId)
    .maybeSingle();

  const rawGemini = (settings?.gemini_api_key as string | null)?.trim() || null;
  const ownGemini = rawGemini && !rawGemini.startsWith('gsk_') ? rawGemini : null;
  const rawGroq = (settings?.groq_api_key as string | null)?.trim() || null;
  const ownGroq = rawGroq && !rawGroq.startsWith('AIza') ? rawGroq : null;
  const tz = ((settings?.timezone as string | null) ?? 'UTC').trim() || 'UTC';
  const today = localDayKey(new Date(), tz);

  const geminiKey = ownGemini ?? env('GEMINI_API_KEY');
  const gemini = geminiProvider(geminiKey);
  const groqKey = ownGroq ?? env('GROQ_API_KEY');
  const provider = groqKey ? withFallback(groqProvider(groqKey, env('GROQ_MODEL') || undefined), gemini) : gemini;
  const onOwnKey = Boolean(ownGroq || (!groqKey && ownGemini));

  // The same daily budget as the app's chat, so a second door is not a way
  // round it.
  const budget = await checkBudget(admin, userId, 'chat', today, onOwnKey);

  await admin.from('chat_messages').insert({ user_id: userId, role: 'user', content: message, via });

  if (!budget.allowed) {
    const reason = 'That is enough questions for today. It resets tomorrow, and everything else works as usual.';
    await admin
      .from('chat_messages')
      .insert({ user_id: userId, role: 'assistant', content: reason, failed: true, via });
    await send(reason);
    return;
  }

  await typing?.();

  const result = await askAbood({ admin, userId, message, today, tz, provider, geminiKey });
  await recordUse(admin, userId, 'chat', today, onOwnKey);

  if (!result.ok) {
    const reason =
      result.failure === 'quota'
        ? 'Out of model requests for now. Try again later.'
        : 'I could not answer that just now. Try again in a minute.';
    await admin
      .from('chat_messages')
      .insert({ user_id: userId, role: 'assistant', content: `${reason} ${result.message}`.slice(0, 1_000), failed: true, via });
    await send(reason);
    return;
  }

  const content = result.warnings.length ? `${result.reply}\n\n${result.warnings.join(' ')}` : result.reply;
  await admin.from('chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content,
    proposed_action: result.action,
    referenced_ids: result.referenced,
    via,
  });

  for (const text of textsOf(content)) await send(text);
  if (result.action) {
    await send(`nothing changes until you confirm it in the planner${APP_URL ? `: ${APP_URL}` : ''}`);
  }

  // Learned after answering, and said out loud: memory that grows in secret
  // is memory nobody can correct.
  const learned = await learn(admin, userId, result.remember, geminiKey, via).catch(() => []);
  if (learned.length) {
    await send(`Noted: ${learned.join(' ')}`);
  }
}
