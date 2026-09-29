/**
 * Reading a timetable title — shared by the Week view and the server.
 *
 * Lives here, beside time.ts, so the morning text reads a class the same way
 * the calendar draws it; `src/lib/blocks.ts` re-exports it for the browser.
 */

/* ============================================================================
   Reading a timetable title
   ========================================================================= */

export interface ReadTitle {
  /** What to lead with: "COEN 231 Lecture", or the title itself. */
  headline: string;
  /** "Section U", when the title carried one. */
  section: string | null;
  /** "MB S2.210", "Remote", or null when the title named no room (or TBA). */
  room: string | null;
  /** Lecture, tutorial, lab — when the title said which. */
  type: string | null;
  /** The course code as written in the title, normalised. */
  code: string | null;
}

const TYPES: Record<string, string> = {
  LEC: 'Lecture',
  TUT: 'Tutorial',
  LAB: 'Lab',
  SEM: 'Seminar',
  STU: 'Studio',
  WKS: 'Workshop',
  PRA: 'Practicum',
};

/*
 * University timetable exports pack four facts into one title, with the least
 * useful one first: "MB S2.210 - COEN 231-U - LEC" is a room, a course, a
 * section and a meeting type. Read left to right it starts with the room, which
 * is the last thing you need when scanning a week and the one fact the event's
 * location field already carries.
 *
 * So a title in exactly that shape is read apart and led with the course and
 * the kind of meeting. Anything that does not match EXACTLY is left as
 * written — a title the person typed is theirs, and rephrasing it is the
 * app rewriting their words on screen.
 */
const TIMETABLE =
  /^(.+?)\s+-\s+([A-Z]{3,4})\s?(\d{3})-([A-Z0-9]+(?:[\s-][A-Z0-9]+)*)\s+-\s+(LEC|TUT|LAB|SEM|STU|WKS|PRA)$/;

export function readTitle(title: string): ReadTitle {
  const m = TIMETABLE.exec(title.trim());
  if (!m) return { headline: title, section: null, room: null, type: null, code: null };

  const [, rawRoom, letters, digits, section, kind] = m;
  const code = `${letters} ${digits}`;
  const type = TYPES[kind];
  const roomWord = rawRoom.trim().toUpperCase();
  const room =
    roomWord === 'TBA' ? null : roomWord === 'REMOTE' || roomWord === 'ONLINE' ? 'Remote' : rawRoom.trim();

  return { headline: `${code} ${type}`, section: `Section ${section}`, room, type, code };
}
