import { useState } from 'react';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { durationLabel } from '../lib/blocks';
import type { CourseEvent } from '../lib/coursePage';
import { prepSessions } from '../lib/examPrep';
import { addAssignment, assignmentDueAt, type Course } from '../lib/planner';
import { flush } from '../lib/outbox';
import { formatDay, localDayKey, todayKey } from '../lib/time';

/**
 * A prep plan for one exam or presentation, offered as a list to change
 * before any of it exists.
 *
 * Each session becomes an ordinary piece of work in the course, due on its
 * day, with its size, so it appears on Today and in Week like anything typed
 * by hand. Titles can be rewritten and sessions dropped; nothing is added
 * until the button that says how many.
 */
export function ExamPrep({
  exam,
  course,
  userId,
  onClose,
  onAdded,
}: {
  exam: CourseEvent;
  course: Course;
  userId: string;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const examDay = localDayKey(new Date(exam.starts_at));
  const [rows, setRows] = useState(() =>
    prepSessions(examDay, todayKey()).map((s) => ({
      ...s,
      title: `${exam.title}: ${s.title.charAt(0).toLowerCase()}${s.title.slice(1)}`,
      keep: true,
    })),
  );
  const [busy, setBusy] = useState(false);
  const kept = rows.filter((r) => r.keep && r.title.trim());

  async function add() {
    setBusy(true);
    for (const r of kept) {
      await addAssignment(userId, {
        title: r.title.trim(),
        course_id: course.id,
        due_at: assignmentDueAt(r.day, null),
        due_has_time: false,
        effort_minutes: r.effort_minutes,
      });
    }
    // Sent before the course page re-reads, or it reads a plan half-written.
    // Offline, the flush ends without sending and the sync banner says so.
    await flush();
    setBusy(false);
    onAdded(kept.length);
    onClose();
  }

  return (
    <Sheet open title={`Prep for ${exam.title}`} onClose={onClose}>
      {rows.length === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="type-body text-text-mid">There is no day left before it to plan for.</p>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="type-body text-text-mid">
            {rows.length} {rows.length === 1 ? 'session' : 'sessions'} before {formatDay(examDay)}, spaced out rather than all at the end. Change any of them;
            nothing is added until you say.
          </p>
          <div className="mat flex flex-col">
            {rows.map((r, i) => (
              <div key={r.day} className="mat-row prep-row" data-dropped={!r.keep || undefined}>
                <input
                  type="checkbox"
                  className="settings-switch"
                  checked={r.keep}
                  aria-label={`Keep the session on ${formatDay(r.day)}`}
                  onChange={(e) => setRows((list) => list.map((x, n) => (n === i ? { ...x, keep: e.target.checked } : x)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block type-caption text-text-low">
                    {formatDay(r.day)} · {durationLabel(r.effort_minutes)}
                  </span>
                  <input
                    className="prep-title type-label"
                    value={r.title}
                    aria-label={`What to do on ${formatDay(r.day)}`}
                    onChange={(e) => setRows((list) => list.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)))}
                  />
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={busy || kept.length === 0} onClick={() => void add()}>
              {busy ? 'Adding' : kept.length ? `Add ${kept.length} ${kept.length === 1 ? 'session' : 'sessions'}` : 'Nothing kept'}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
