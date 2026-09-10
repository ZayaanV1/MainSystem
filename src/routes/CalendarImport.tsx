import { useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { addEvent, type Course } from '../lib/planner';
import { parseIcs, type ParsedEvent } from '../../supabase/functions/_shared/icsparse';
import { formatDay } from '../lib/time';

/**
 * Importing a timetable.
 *
 * The app has published an .ics since Phase 7 and could never read one, which
 * is most of the reason there has never been a class schedule in it. Every
 * university publishes a timetable feed; the alternative to importing it is
 * typing thirteen weeks of lectures by hand, which nobody does — so the
 * schedule a student's whole week hangs on simply was not represented.
 *
 * PASTE, NOT SUBSCRIBE
 *
 * Deliberately a one-time import rather than a live subscription. A
 * subscription means a background fetch of a third-party URL on a schedule,
 * which is a new failure mode, a new cost on a shared free tier, and a way for
 * events to change underneath someone without them asking. A timetable is set
 * at the start of term and barely moves; a paste is the honest size of the
 * problem.
 *
 * Fetching the URL is also not something the browser can do — timetable hosts
 * do not send CORS headers — so a URL field would be a button that fails for
 * everyone. Paste is not a compromise here, it is the only thing that works
 * without an edge function proxying arbitrary user-supplied URLs.
 *
 * NOTHING IS WRITTEN UNTIL IT IS CONFIRMED
 *
 * Rule 6, same as parsed food and extracted syllabus dates. Everything is
 * previewed, everything can be excluded individually, and what the parser
 * could not read is stated rather than quietly missing.
 */

interface CalendarImportProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  courses: Course[];
  onImported: () => void;
}

export function CalendarImport({ open, onClose, userId, courses, onImported }: CalendarImportProps) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ events: ParsedEvent[]; skipped: string[] } | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [courseId, setCourseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function run() {
    // The reader's offset from UTC, for stamps that carry a Z. Taken from the
    // host rather than a setting because it describes THIS device's clock.
    const offset = -new Date().getTimezoneOffset();
    setParsed(parseIcs(text, offset));
    setExcluded(new Set());
    setResult(null);
  }

  const chosen = parsed ? parsed.events.filter((_, i) => !excluded.has(i)) : [];
  const total = chosen.reduce((n, e) => n + e.days.length, 0);

  async function save() {
    if (!parsed) return;
    setSaving(true);

    let written = 0;
    for (const e of chosen) {
      for (const day of e.days) {
        await addEvent(userId, {
          title: e.summary,
          // Everything imported is a plain event. Calling a lecture an "exam"
          // would give it the T-1 escalation, and a timetable escalating every
          // weekday at 20:00 is how someone turns notifications off entirely.
          kind: 'other',
          day,
          time: e.time,
          course_id: courseId,
          notes: e.location,
        });
        written += 1;
      }
    }

    setSaving(false);
    setResult(`${written} added.`);
    setText('');
    setParsed(null);
    onImported();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Import a timetable">
      <div className="flex flex-col gap-4">
        {!parsed ? (
          <>
            <p className="type-note text-text-mid">
              Paste the contents of a <span className="tag type-caption">.ics</span> file. Most
              universities offer one under a name like &ldquo;export timetable&rdquo; or
              &ldquo;subscribe to calendar&rdquo; — download it, open it in a text editor and paste
              the lot.
            </p>
            <div className="flex flex-col gap-2">
              <label htmlFor="ics" className="action-chip type-label">
                Calendar file
              </label>
              <textarea
                id="ics"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="BEGIN:VCALENDAR…"
                className="w-full rounded-card border border-ink-600 bg-ink-800 px-4 py-3 type-body text-text-hi placeholder:text-text-low"
              />
              <p className="type-note text-text-low">
                Nothing is added until you have seen what it found.
              </p>
            </div>
            <div>
              <Button variant="primary" disabled={!text.trim()} onClick={run}>
                Read it
              </Button>
            </div>
          </>
        ) : (
          <>
            {parsed.events.length === 0 ? (
              <p className="type-body text-text-mid">
                No events found in that. It may not be an .ics file.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <span className="type-label text-text-hi">
                    {parsed.events.length}{' '}
                    {parsed.events.length === 1 ? 'entry' : 'entries'}, {total}{' '}
                    {total === 1 ? 'event' : 'events'} in total
                  </span>
                  <span className="type-note text-text-low">
                    A repeating class counts once here and once per week below.
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="type-label text-text-mid">Put them all under</span>
                  <select
                    value={courseId ?? ''}
                    onChange={(e) => setCourseId(e.target.value || null)}
                    className="min-h-[var(--tap)] rounded-card border border-ink-600 bg-ink-800 px-3 type-body text-text-hi"
                  >
                    <option value="">No course</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code ?? c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <Card>
                  {parsed.events.map((e, i) => {
                    const off = excluded.has(i);
                    return (
                      <Pressable
                        key={`${e.uid ?? e.summary}-${i}`}
                        align="start"
                        onClick={() =>
                          setExcluded((s) => {
                            const next = new Set(s);
                            if (off) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className={`flex-col gap-1 border-b border-ink-600 px-4 py-3 last:border-b-0 ${
                          off ? 'opacity-40' : ''
                        }`}
                      >
                        <span className="type-body text-text-hi">{e.summary}</span>
                        <span className="flex flex-wrap gap-2">
                          <span className="type-note text-text-mid">
                            {formatDay(e.day)}
                            {e.time ? ` ${e.time}` : ' all day'}
                          </span>
                          {e.repeats && (
                            <span className="tag type-caption">{e.days.length} weeks</span>
                          )}
                          {e.location && <span className="tag type-caption">{e.location}</span>}
                          {off && <span className="tag type-caption">skipped</span>}
                        </span>
                      </Pressable>
                    );
                  })}
                </Card>

                {/*
                  What could not be read, stated plainly. A feed that parses to
                  fewer events than it contains looks exactly like a feed with
                  fewer events in it, which is why this is never silent.
                */}
                {parsed.skipped.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="type-label text-text-hi">Not imported</span>
                    {parsed.skipped.map((s, i) => (
                      <span key={i} className="type-note text-text-mid">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-2">
              {parsed.events.length > 0 && (
                <Button variant="primary" disabled={total === 0 || saving} onClick={() => void save()}>
                  {saving ? 'Adding' : `Add ${total} ${total === 1 ? 'event' : 'events'}`}
                </Button>
              )}
              <Button variant="quiet" onClick={() => setParsed(null)}>
                Back
              </Button>
            </div>
          </>
        )}

        {result && <p className="type-note text-t-done">{result}</p>}
      </div>
    </Sheet>
  );
}
