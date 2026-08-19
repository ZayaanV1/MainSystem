/**
 * Types shared across the delivery pipeline.
 *
 * The important boundary in this file is between a *message* and a *channel*.
 * The digest builder produces an OutboundMessage and has no idea how it will
 * be delivered. A channel receives an OutboundMessage and has no idea what is
 * in it or why. Neither side imports the other.
 *
 * That separation is not architectural taste — it is the reason Phase 0 can
 * proceed while it is still unknown whether iOS Web Push survives its soak.
 */

export type ChannelKind = 'telegram' | 'webpush';

export type DeliveryKind = 'digest' | 'test' | 'escalation' | 'reminder' | 'weekly';

export type DeliveryStatus = 'sent' | 'failed' | 'skipped';

export interface OutboundMessage {
  /** Short. Becomes the notification title, or the first line on Telegram. */
  title: string;
  /** Plain text. No markup — every channel renders it differently and the
   *  escaping bugs are never worth the formatting. */
  body: string;
  /** Where tapping the notification should land. */
  deepLink?: string;
}

/**
 * `dead` distinguishes "this channel is broken and should stop being tried"
 * from "this attempt failed". A Web Push endpoint returning 410 Gone is dead;
 * a 500 from Telegram is merely unlucky. Getting this wrong in either
 * direction is bad: retrying a dead channel forever hides the failure, and
 * retiring a live channel over one blip silently stops the notifications.
 */
export type SendResult = { ok: true } | { ok: false; error: string; dead: boolean };
