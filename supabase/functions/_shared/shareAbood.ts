import { int, str, ToolError, type ToolDef } from './mcp.ts';
import { json, must, type ConnectorCtx } from './connector.ts';
import { datedFact } from './abood.ts';
import { textsOf } from './door.ts';
import { formatDay, formatTime, localDayKey } from './time.ts';

/**
 * Abood's memory and voice for a connected app (10 Nov 2026), so Abood in a
 * Claude project and Abood over text are one friend, not two.
 *
 * Connector only: these are never in ALL_TOOLS, which Abood himself runs.
 * Every tool checks app_settings.share_abood (off by default, migration 0054);
 * the reads are bounded by RLS like the rest of the connector, the writes go
 * through security-definer functions that check the switch again.
 */

const OFF = 'Sharing Abood with connected apps is off. The account can turn it on in the planner: Settings, Connected apps.';

async function shareOn(ctx: ConnectorCtx): Promise<void> {
  const row = await must(ctx.db.from('app_settings').select('share_abood').eq('user_id', ctx.userId).maybeSingle());
  if (!row?.share_abood) throw new ToolError(OFF);
}

const recallMemory: ToolDef<ConnectorCtx> = {
  name: 'recall_memory',
  description:
    'What Abood remembers about the user, newest first, each led by the day they told him. Optional "about" narrows it to facts containing those words.',
  inputSchema: {
    type: 'object',
    properties: { about: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 80 } },
    additionalProperties: false,
  },
  readOnly: true,
  async run(args, ctx) {
    await shareOn(ctx);
    const about = str(args, 'about', { max: 80 });
    let q = ctx.db.from('memory_facts').select('fact, created_at').eq('user_id', ctx.userId);
    // Any of the words, so "french class" finds "French midterm".
    const words = (about ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    if (words.length) q = q.or(words.map((w) => `fact.ilike.%${w}%`).join(','));
    const rows = (await must(q.order('created_at', { ascending: false }).limit(int(args, 'limit', 1, 80) ?? 40))) ?? [];
    return json({ memories: rows.map((r: { fact: string; created_at: string }) => datedFact(r.fact, r.created_at, ctx.tz)) });
  },
};

const remember: ToolDef<ConnectorCtx> = {
  name: 'remember',
  description:
    'Save one short third-person fact or moment about the user to Abood\'s memory, so he can bring it up when they text him. 8-200 characters, no date (the day is added).',
  inputSchema: { type: 'object', properties: { fact: { type: 'string', minLength: 8, maxLength: 200 } }, required: ['fact'], additionalProperties: false },
  readOnly: false,
  async run(args, ctx) {
    await shareOn(ctx);
    const fact = str(args, 'fact', { max: 200, required: true })!;
    if (fact.length < 8) throw new ToolError('"fact" must be at least 8 characters.');
    const kept = await must(ctx.db.rpc('connector_remember', { p_fact: fact }));
    return json(kept ? { remembered: fact } : { unchanged: 'Abood already remembers that.' });
  },
};

const recentConversation: ToolDef<ConnectorCtx> = {
  name: 'recent_conversation',
  description: 'The latest messages between the user and Abood (app, Telegram, iMessage), oldest first, so a thread can be picked up.',
  inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 60 } }, additionalProperties: false },
  readOnly: true,
  async run(args, ctx) {
    await shareOn(ctx);
    const rows =
      (await must(
        ctx.db
          .from('chat_messages')
          .select('role, content, via, created_at')
          .eq('user_id', ctx.userId)
          .order('created_at', { ascending: false })
          .limit(int(args, 'limit', 1, 60) ?? 20),
      )) ?? [];
    return json({
      messages: rows
        .reverse()
        .map((m: { role: string; content: string; via: string; created_at: string }) => ({
          from: m.role === 'user' ? 'user' : 'abood',
          via: m.via,
          at: `${formatDay(localDayKey(new Date(m.created_at), ctx.tz), ctx.tz)} ${formatTime(new Date(m.created_at), ctx.tz)}`,
          text: m.content,
        })),
    });
  },
};

const BOT = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

const textMe: ToolDef<ConnectorCtx> = {
  name: 'text_me',
  description:
    'Send the user a text as Abood, by iMessage when their Mac bridge is up, otherwise Telegram. Only ever to the user themself. Use only when they ask to be texted something. Short bubbles, lowercase, like Abood.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['text'], additionalProperties: false },
  readOnly: false,
  async run(args, ctx) {
    await shareOn(ctx);
    const texts = textsOf(str(args, 'text', { max: 2000, required: true })!);
    const [link, bridge, tg] = await Promise.all([
      must(ctx.db.from('imessage_links').select('handle').eq('user_id', ctx.userId).limit(1)),
      must(ctx.db.from('imessage_bridges').select('last_seen').eq('user_id', ctx.userId).maybeSingle()),
      must(ctx.db.from('notification_channels').select('config').eq('user_id', ctx.userId).eq('kind', 'telegram').eq('enabled', true).limit(1)),
    ]);
    const bridgeUp = bridge?.last_seen && Date.now() - Date.parse(bridge.last_seen) < 10 * 60_000;
    const chatId = tg?.[0]?.config?.chat_id as string | undefined;
    const via = link?.[0]?.handle && bridgeUp ? 'imessage' : chatId && BOT ? 'telegram' : null;
    if (!via) throw new ToolError('Abood has no way to text the user right now: link iMessage (with the Mac bridge running) or Telegram in the planner.');

    await must(ctx.db.rpc('connector_text_me', { p_texts: texts, p_via: via }));
    if (via === 'telegram') {
      for (const [i, t] of texts.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, 900));
        const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: t, disable_web_page_preview: true }),
        }).catch(() => null);
        if (!res?.ok) throw new ToolError(`Telegram did not take the text${i ? ` after ${i} sent` : ''}. Try again shortly.`);
      }
    }
    return json({ sent: via === 'imessage' ? 'Queued for iMessage; the Mac sends it within a minute.' : 'Sent on Telegram.', texts });
  },
};

export const SHARE_ABOOD_TOOLS: ToolDef<ConnectorCtx>[] = [recallMemory, remember, recentConversation, textMe];
