/**
 * Saying out loud what the screen just showed.
 *
 * This app is built on optimistic writes: you tap, the row changes, the write
 * goes out afterwards. That is the right design and it is silent — the change
 * is conveyed entirely by pixels moving. A screen reader user taps "done" and
 * gets nothing back, because the row they were focused on quietly restyled
 * itself and no announcement was made.
 *
 * An audit on 8 Sep found exactly ONE aria-live region in the whole app, on
 * the sync banner. Completing work, logging food, deferring a task, importing
 * a syllabus — none of it announced.
 *
 * WHY A SHARED REGION RATHER THAN aria-live ON EACH ROW
 *
 * Putting a live region on every row means the browser watches dozens of them
 * and announces whichever mutates — including rows that changed because a
 * filter was applied or a list reordered, which nobody asked to hear. One
 * region that is written to deliberately says only what was actually done.
 *
 * It also survives the element disappearing. Deferring a task removes it from
 * today's list, so a message attached to that row would be destroyed before it
 * could be read.
 */

const REGION_ID = 'app-announcer';

/**
 * The delay before the text lands.
 *
 * A live region that has its text replaced in the same frame the DOM mutates
 * is frequently missed: the assistive technology is still processing the
 * change that triggered it. A tick later is reliably picked up and is far
 * below the threshold where it would feel disconnected from the tap.
 */
const SETTLE_MS = 120;

let timer: ReturnType<typeof setTimeout> | null = null;

function region(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(REGION_ID);
  if (existing) return existing;

  const el = document.createElement('div');
  el.id = REGION_ID;
  // Polite: these are confirmations of something the user just did, not
  // interruptions. Assertive would cut off whatever is being read, which for
  // a confirmation is rude and for a list is disorienting.
  el.setAttribute('aria-live', 'polite');
  // Announce the whole message when any part changes, rather than only the
  // changed words — otherwise "2 items" following "3 items" reads as "2".
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('role', 'status');

  // Visually hidden, not display:none — a hidden region is not announced at
  // all, which is the classic way this technique silently does nothing.
  el.style.cssText =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
    'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';

  document.body.appendChild(el);
  return el;
}

/**
 * Announces one short sentence.
 *
 * Same copy voice as everywhere else: plain, active, no exclamation. It says
 * what happened, in the words the user would use — "Marked done", not "Status
 * updated".
 */
export function announce(message: string): void {
  const el = region();
  if (!el) return;

  if (timer) clearTimeout(timer);

  // Cleared first so that announcing the same message twice in a row is heard
  // twice. Without this, ticking two items called "Reading" would announce
  // once, because the text never changed.
  el.textContent = '';
  timer = setTimeout(() => {
    el.textContent = message;
  }, SETTLE_MS);
}
