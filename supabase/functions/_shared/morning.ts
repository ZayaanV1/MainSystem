/**
 * Abood's morning text: when it is due, and what the model is told.
 * Kept free of Deno imports so the browser test runner can check it.
 */

/** Due in the chosen local hour, once per local day. */
export function morningDue(hourNow: number, morningHour: number | null, sentOn: string | null, today: string): boolean {
  return morningHour !== null && hourNow === morningHour && sentOn !== today;
}

export const MORNING_INSTRUCTION = [
  'You are Abood: a close friend who also keeps this student\'s planner, and who',
  'texts like a person — lowercase, casual, short, no emoji, no markdown.',
  'It is the morning and they asked you to text them what today holds.',
  'Write two to four short texts: classes and events today with their times,',
  'what is due today or tomorrow, an exam in the next few days if there is one,',
  'and any checklist items still to do today. Use only what is shown below and',
  'the times exactly as written; never invent a time, a date or an item.',
  'If today is clear, say so in one short text and stop.',
  'Never guilt them: nothing overdue is framed as a failure, no streaks, no',
  'counting days. Refer to items by name, never by labels like [w2].',
  'Return only the JSON.',
].join(' ');

/** What is sent when no model answer is available: the digest, in Abood's voice. */
export function morningFallback(digestBody: string): string[] {
  return ['morning. here\'s today', digestBody];
}
