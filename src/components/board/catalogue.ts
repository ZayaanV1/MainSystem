import type { WidgetSize, WidgetType } from '../../lib/board';

/**
 * What the gallery says about each widget: its name, where it is filed, one
 * line on what it does, and words a search should find it by.
 */

export const CATEGORIES = ['Today', 'Calendar', 'Time', 'Progress', 'Capture', 'Personal'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface WidgetInfo {
  name: string;
  cat: Category;
  desc: string;
  keywords: string;
}

export const INFO: Record<WidgetType, WidgetInfo> = {
  due: { name: 'Next due', cat: 'Today', desc: 'A live countdown to the nearest deadline', keywords: 'deadline countdown assignment' },
  work: { name: 'Assignments', cat: 'Today', desc: 'Open work by due date. Tick to finish', keywords: 'homework tasks todo work' },
  now: { name: 'What now?', cat: 'Today', desc: 'Say how long you have, get one task and why', keywords: 'pick next suggest decide' },
  list: { name: 'Checklist', cat: 'Today', desc: 'Today’s daily items, ticked from here', keywords: 'daily routine habits' },
  class: { name: 'Next class', cat: 'Today', desc: 'Where you need to be next, and when', keywords: 'lecture lab room schedule up next' },
  week: { name: 'Week', cat: 'Calendar', desc: 'Seven days of deadlines and exams', keywords: 'calendar schedule seven days weekly' },
  month: { name: 'Month', cat: 'Calendar', desc: 'The whole month with deadlines marked. Tap a day', keywords: 'calendar large month view monthly' },
  agenda: { name: 'Day planner', cat: 'Calendar', desc: 'Today on a timeline: classes, deadlines, now', keywords: 'timeline schedule hours planner agenda' },
  exams: { name: 'Exams', cat: 'Calendar', desc: 'Upcoming exams, nearest first', keywords: 'midterm final test quiz' },
  clock: { name: 'Clock', cat: 'Time', desc: 'Analog, digital, flip or dot-matrix faces', keywords: 'time watch' },
  clockday: { name: 'Clock and day', cat: 'Time', desc: 'A clock beside what is left of today', keywords: 'clock planner timeline combo' },
  count: { name: 'Countdown', cat: 'Time', desc: 'Days until a date you name', keywords: 'days until event holiday break' },
  focus: { name: 'Focus timer', cat: 'Time', desc: 'Start the timer on your next task and see it run', keywords: 'timer study session focus' },
  term: { name: 'Term', cat: 'Time', desc: 'Which week of term it is, from your classes', keywords: 'semester week progress' },
  goal: { name: 'Goal', cat: 'Progress', desc: 'Progress toward a number by a date, like chapters read', keywords: 'target reading chapters tracker' },
  grades: { name: 'Marks so far', cat: 'Progress', desc: 'Your marked work in each course, as the arithmetic', keywords: 'grades marks gpa' },
  capture: { name: 'Quick capture', cat: 'Capture', desc: 'Type a thought, it lands in your inbox', keywords: 'inbox add note thought' },
  photo: { name: 'Photo', cat: 'Personal', desc: 'A picture from your camera roll', keywords: 'picture image' },
  music: { name: 'Spotify', cat: 'Personal', desc: 'A playlist, album or track from a link, playing here', keywords: 'music playlist song spotify' },
  link: { name: 'Link', cat: 'Personal', desc: 'Any website, one tap away', keywords: 'url web bookmark site' },
};

/** The row of suggestions at the top of the gallery, at the size they arrive in. */
export const SUGGESTED: readonly { type: WidgetType; size: WidgetSize; opts?: Record<string, string> }[] = [
  { type: 'goal', size: 's' },
  { type: 'due', size: 's' },
  { type: 'month', size: 's' },
  { type: 'now', size: 's' },
  { type: 'clock', size: 's', opts: { face: 'flip' } },
  { type: 'focus', size: 's' },
  { type: 'term', size: 's' },
];

/** Gallery search: every word typed must appear somewhere in the widget's description. */
export function matches(type: WidgetType, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return true;
  const i = INFO[type];
  const hay = `${i.name} ${i.cat} ${i.desc} ${i.keywords}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Spotify's own share link, as the parts its embed needs. */
export function spotifyEmbed(url: string): { kind: string; id: string } | null {
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,})/u.exec(url ?? '');
  return m ? { kind: m[1], id: m[2] } : null;
}

/** An http(s) address, or null. A link widget never opens anything else. */
export function safeLink(url: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/iu.test(url) ? url : `https://${url}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
