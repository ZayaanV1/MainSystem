/**
 * How the Week view draws its blocks.
 *
 * Five renderings of the same data. None of them hides anything the others
 * show — every style carries the time, the title, the room, the course and
 * every deadline with its written urgency — so the choice is about how a week
 * reads, never about what it contains.
 *
 * PER DEVICE, like the theme, and for the same reason. The right way to read
 * a week on a phone held in one hand is not the right way on a laptop: a
 * seven-column hour grid is the best thing on a wide screen and a cramped one
 * on a narrow screen. Syncing the choice would make the laptop change when the
 * phone did. See theme.ts for the longer version of this argument.
 */

export type CalendarStyle = 'list' | 'rail' | 'bubble' | 'hours' | 'ticket' | 'ledger';

export const CALENDAR_STYLES: { value: CalendarStyle; label: string; hint: string }[] = [
  { value: 'list', label: 'List', hint: 'Each day a group of rows, and empty days said once' },
  { value: 'rail', label: 'Rail', hint: 'The week on one spine, as a list' },
  { value: 'bubble', label: 'Bubble', hint: 'Tinted blocks sized by how long they run' },
  { value: 'hours', label: 'Hours', hint: 'An hour grid, with a line for now' },
  { value: 'ticket', label: 'Ticket', hint: 'Each class a stub, clipped once it has run' },
  { value: 'ledger', label: 'Ledger', hint: 'A printed timetable, all type and rules' },
];

const KEY = 'planner.calendarStyle';

/**
 * List, since the iPhone review (12 Oct 2026). Rail was the default and was
 * stored as no value at all, so everyone who never chose moves to List, and
 * a style anyone did choose is kept.
 */
const DEFAULT: CalendarStyle = 'list';

function isStyle(v: unknown): v is CalendarStyle {
  return CALENDAR_STYLES.some((s) => s.value === v);
}

export function readCalendarStyle(): CalendarStyle {
  try {
    const raw = localStorage.getItem(KEY);
    return isStyle(raw) ? raw : DEFAULT;
  } catch {
    // Private mode or storage disabled: the default still renders the week.
    return DEFAULT;
  }
}

export function writeCalendarStyle(style: CalendarStyle): void {
  try {
    if (style === DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, style);
  } catch {
    // Not fatal: the choice holds for this visit.
  }
}
