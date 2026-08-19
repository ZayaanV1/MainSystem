/**
 * Building an iCalendar feed.
 *
 * The point of this is that deadlines show up where you already look. A
 * planner you have to remember to open is competing with the calendar app on
 * your lock screen, and it loses.
 *
 * RFC 5545 is fussy in ways that fail silently: a line over 75 octets, an
 * unescaped comma, or CRLF written as LF, and a subscribing client will accept
 * the feed and quietly drop events. Each of those is handled below rather than
 * hoped about.
 */

export interface IcsEvent {
  uid: string;
  /** UTC instant. */
  start: Date;
  /** UTC instant, or null for a point in time. */
  end: Date | null;
  /** True for a date with no time; rendered as a whole-day entry. */
  allDay: boolean;
  summary: string;
  description?: string | null;
}

/**
 * Escapes a text value.
 *
 * Backslash first, or it would escape the escapes added afterwards.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a line to 75 octets, as the spec requires.
 *
 * Counted in UTF-8 bytes rather than characters, and never split mid-character
 * — an assignment title with an accent or an em dash would otherwise produce a
 * broken sequence and a rejected feed.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Continuation lines start with a space, which itself costs one octet.
  let limit = 75;

  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) parts.push(current);

  return parts.join('\r\n ');
}

const stampUTC = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` +
  `T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;

const stampDate = (d: Date, tz: string): string => {
  // An all-day entry is a local calendar date, not an instant. Formatting it
  // in UTC would put a Friday deadline on Thursday for anyone west of it.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts.replace(/-/g, '');
};

export function buildIcs(
  events: IcsEvent[],
  options: { name: string; timezone: string; now?: Date },
): string {
  const now = options.now ?? new Date();

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//life-planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    `X-WR-TIMEZONE:${options.timezone}`,
    // Clients poll on their own schedule; this is a request, not a promise.
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H',
    'X-PUBLISHED-TTL:PT2H',
  ];

  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stampUTC(now)}`);

    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${stampDate(e.start, options.timezone)}`);
    } else {
      lines.push(`DTSTART:${stampUTC(e.start)}`);
      if (e.end) lines.push(`DTEND:${stampUTC(e.end)}`);
    }

    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // CRLF is required. Plain \n is the single most common reason a feed
  // validates by eye and is rejected by a client.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
