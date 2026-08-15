/**
 * Telegram delivery.
 *
 * Chosen as the channel that proves the pipeline first, because it rides the
 * Telegram app's own native push and therefore cannot fail for any of the
 * reasons iOS Web Push might. If a digest fails to arrive with this channel
 * configured, the bug is in our scheduler or our digest — not in Apple.
 *
 * The bot token is a shared secret and lives in the function environment. Only
 * the chat_id, which is per-user routing data and not sensitive on its own,
 * lives in the database.
 */

import type { OutboundMessage, SendResult } from '../types.ts';

export interface TelegramConfig {
  chat_id: string;
}

/**
 * Errors that mean this channel will never work again without user action, as
 * opposed to a transient failure worth retrying tomorrow. Retiring a channel
 * over a blip would silently stop the notifications, so this list is
 * deliberately narrow.
 */
function isDead(status: number, description: string): boolean {
  if (status === 403) return true; // bot blocked, or kicked from the chat
  if (status === 400 && /chat not found|chat_id is empty/i.test(description)) return true;
  if (status === 401) return true; // token revoked
  return false;
}

export async function sendTelegram(
  msg: OutboundMessage,
  config: TelegramConfig,
  botToken: string,
): Promise<SendResult> {
  if (!botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set', dead: false };
  }
  if (!config?.chat_id) {
    return { ok: false, error: 'channel has no chat_id', dead: true };
  }

  // Sent as plain text with no parse_mode. Telegram's Markdown and HTML modes
  // both reject unescaped punctuation that appears constantly in assignment
  // titles, and a digest that fails to send because a course name contains an
  // underscore is a worse outcome than unstyled text. Bare URLs are still
  // auto-linked, so the deep link works without markup.
  const text = [msg.title, '', msg.body, msg.deepLink ? `\n${msg.deepLink}` : '']
    .join('\n')
    .trim();

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chat_id,
        text,
        disable_notification: false,
        link_preview_options: { is_disabled: true },
      }),
    });

    if (res.ok) return { ok: true };

    const payload = (await res.json().catch(() => ({}))) as { description?: string };
    const description = payload.description ?? `HTTP ${res.status}`;

    return {
      ok: false,
      error: `telegram: ${description}`,
      dead: isDead(res.status, description),
    };
  } catch (e) {
    // Network-level failure. Never fatal — the phone may simply be offline, or
    // Telegram may be having a minute.
    return { ok: false, error: `telegram: ${(e as Error).message}`, dead: false };
  }
}
