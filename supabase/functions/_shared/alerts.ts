/**
 * Telling the person who runs this that something is failing.
 *
 * A deployment that fails quietly is the failure this exists for: the digest
 * was refused by both channels for over a week, 57 times, and the only record
 * was a table nobody was reading. A failure now says so, once, where it will
 * be seen.
 *
 * Two places, both optional. Every alert is written to the function log as one
 * structured line, which needs no setup. If ALERT_TELEGRAM_CHAT_ID is set
 * (with the bot token the digest already uses) it is also sent to that chat.
 * Nothing here ever includes a title, a note or an address: an alert names an
 * account by id and says what failed, so it can be read, pasted or forwarded
 * without leaking anyone's work.
 *
 * Alerts never throw. Reporting a failure must not become a second one.
 */

export interface AlertConfig {
  telegramBotToken: string;
  /** The chat to tell, when set. */
  chatId: string;
}

export type AlertKind = 'digest-gave-up' | 'channel-retired' | 'tick-failed';

export interface Alert {
  kind: AlertKind;
  /** The account, by id only. */
  userId?: string;
  /** What failed, in a sentence with no personal data. */
  detail: string;
}

/** A sentence for a person. */
export function describeAlert(a: Alert): string {
  const who = a.userId ? ` (account ${a.userId.slice(0, 8)})` : '';
  const what: Record<AlertKind, string> = {
    'digest-gave-up': 'A morning digest could not be delivered and was given up on for the day',
    'channel-retired': 'A notification channel was switched off after it stopped working',
    'tick-failed': 'A scheduled run failed',
  };
  return `${what[a.kind]}${who}. ${a.detail}`.trim();
}

export async function alertOperator(config: AlertConfig, a: Alert): Promise<boolean> {
  const text = describeAlert(a);
  // One line, machine-readable, always written.
  console.error(JSON.stringify({ alert: a.kind, user: a.userId ?? null, detail: a.detail.slice(0, 300) }));

  if (!config.telegramBotToken || !config.chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text: `Planner alert\n\n${text}`, link_preview_options: { is_disabled: true } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
