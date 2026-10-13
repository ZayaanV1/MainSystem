/**
 * Whether a title names an exam or presentation itself, or only mentions one.
 *
 * Exams and presentations become events, and events get the night-before
 * escalation and have no done toggle. So "study for midterm", "midterm review
 * session" or "practice exam questions" read as an exam would send a false
 * warning the evening before, and leave a piece of work that cannot be ticked
 * off. Shared by the calendar sync (`feedsync.ts`) and plain-language capture
 * (`src/lib/quickParse.ts`), which used to keep two rules and disagreed: the
 * sync's was narrow, capture's matched any title containing "midterm".
 */

/**
 * Words that make a title ABOUT an exam or presentation rather than the thing
 * itself. Prefixes on purpose: "prep" covers "preparation", "rehears" covers
 * "rehearsal" and "rehearse", "stud" covers "study" and "studying".
 */
export const NOT_THE_EVENT =
  /\b(practice|practise|sample|due|available|seat|registration|deadline|accommodation|stud(y|ying|ied)|review|prep|rehears|slides|office hours)/i;

/** Mentions the event and is not merely about it. */
export function namesTheEvent(title: string, event: RegExp): boolean {
  return event.test(title) && !NOT_THE_EVENT.test(title);
}
