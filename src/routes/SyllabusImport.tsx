import { useRef, useState } from 'react';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Sheet } from '../components/Sheet';
import { readFile, readSyllabus } from '../lib/assist';
import { addAssignment, addEvent, assignmentDueAt, type Course } from '../lib/planner';
import type { SyllabusItem } from '../../supabase/functions/_shared/syllabus';

/**
 * Importing a semester of deadlines from a syllabus.
 *
 * From the spec: "Manual entry of a semester's deadlines never gets done, and
 * an incomplete calendar is an untrusted calendar." The second half is why
 * this screen is a review table rather than an "Import" button — the failure
 * that matters is not a missed import, it is fourteen rows landing silently
 * with one of them dated by a guessed year, producing a calendar that looks
 * finished and lies.
 *
 * So: everything is listed, everything is editable, undated items are called
 * out rather than buried, and nothing is written until it is confirmed.
 *
 * Undated items are still imported. They are real work, the app already has a
 * place for work with no date, and dropping them is exactly how the calendar
 * becomes incomplete. They arrive visibly undated.
 */

type Draft = SyllabusItem & { keep: boolean };

export function SyllabusImport({
  open,
  userId,
  courses,
  onClose,
  onImported,
}: {
  open: boolean;
  userId: string;
  courses: Course[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setText('');
    setCourseId(null);
    setDrafts(null);
    setWarnings([]);
    setProblem(null);
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function run(input: { text?: string; pdf?: { data: string; mimeType: string } }) {
    setBusy(true);
    setProblem(null);

    const result = await readSyllabus(input);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.reason);
      return;
    }

    setDrafts(result.items.map((i) => ({ ...i, keep: true })));
    setWarnings(result.warnings);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const pdf = await readFile(file);
    setBusy(false);

    if (!pdf) {
      setProblem("Couldn't read that file. Paste the text instead.");
      return;
    }
    await run({ pdf });
  }

  const edit = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => (list ?? []).map((d, i) => (i === index ? { ...d, ...patch } : d)));

  async function commit() {
    const keeping = (drafts ?? []).filter((d) => d.keep);
    if (keeping.length === 0) {
      setProblem('Nothing selected to import.');
      return;
    }

    setBusy(true);
    setProblem(null);

    for (const item of keeping) {
      // A dated exam or presentation becomes a calendar event, which is what
      // gets the T-1 escalation. Everything else — and anything undated —
      // becomes work, because an event row cannot exist without a date and
      // dropping the item would be the incomplete calendar all over again.
      const isEvent = item.due_date !== null && (item.kind === 'exam' || item.kind === 'presentation');

      if (isEvent) {
        await addEvent(userId, {
          title: item.title,
          kind: item.kind === 'exam' ? 'exam' : 'presentation',
          day: item.due_date as string,
          time: item.due_time,
          course_id: courseId,
          // An event carries no weight column of its own; the note stays the
          // honest place for it until events gain one.
          notes: item.weight_percent ? `${item.weight_percent}% of the grade` : null,
        });
      } else {
        await addAssignment(userId, {
          title: item.title,
          course_id: courseId,
          due_at: assignmentDueAt(item.due_date, item.due_time),
          due_has_time: Boolean(item.due_time),
          // Was discarded entirely on this branch — the event branch at least
          // flattened it into a note, assignments dropped it on the floor. The
          // model was being paid to read "worth 30%" and the answer was thrown
          // away at the last step.
          weight_percent: item.weight_percent,
        });
      }
    }

    setBusy(false);
    onImported();
    close();
  }

  const keeping = (drafts ?? []).filter((d) => d.keep).length;
  const undated = (drafts ?? []).filter((d) => d.keep && d.due_date === null).length;

  return (
    <Sheet open={open} onClose={close} title={drafts ? 'Check these' : 'Import a syllabus'}>
      {drafts === null ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="syllabus" className="kicker">
              Paste the syllabus
            </label>
            <textarea
              id="syllabus"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste the evaluation section, or the whole thing."
              className="well py-3 type-body text-text-hi placeholder:text-text-low"
            />
            <p className="type-note text-text-low">
              Dates are only used when the syllabus states one. "Week 6" stays undated.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={text.trim().length < 20 || busy}
              onClick={() => void run({ text: text.trim() })}
            >
              {busy ? 'Reading' : 'Read it'}
            </Button>

            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="quiet" disabled={busy} onClick={() => fileInput.current?.click()}>
              Use a PDF
            </Button>
          </div>

          {problem && (
            <p className="type-body text-t-overdue" role="alert">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="type-note text-text-low">
            Nothing is added until you import. Untick anything that is wrong, and fix any date.
          </p>

          {courses.length > 0 && (
            <div className="flex flex-col gap-3">
              <span className="tag type-label">Course</span>
              <div className="flex flex-wrap gap-2">
                {courses.map((c) => (
                  <Chip
                    key={c.id}
                    selected={courseId === c.id}
                    onClick={() => setCourseId(courseId === c.id ? null : c.id)}
                  >
                    {c.code ?? c.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {drafts.map((d, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-card border border-ink-600 p-3">
                <Pressable align="start" className="gap-3"
                  onClick={() => edit(i, { keep: !d.keep })}
                  aria-pressed={d.keep}>
                  <span
                    aria-hidden
                    className={[
                      'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
                      d.keep ? 'border-t-done bg-t-done' : 'border-ink-600',
                    ].join(' ')}
                  />
                  <span className={`type-body ${d.keep ? 'text-text-hi' : 'text-text-low'}`}>
                    {d.title}
                  </span>
                </Pressable>

                {d.keep && (
                  <div className="flex flex-wrap items-end gap-3 pl-8">
                    <label className="flex flex-col gap-1">
                      <span className="kicker">Date</span>
                      <input
                        type="date"
                        value={d.due_date ?? ''}
                        onChange={(e) => edit(i, { due_date: e.target.value || null })}
                        className="well px-3 type-body"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="kicker">Time</span>
                      <input
                        type="time"
                        value={d.due_time ?? ''}
                        onChange={(e) => edit(i, { due_time: e.target.value || null })}
                        className="well px-3 type-body"
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      {(['assignment', 'exam', 'presentation'] as const).map((k) => (
                        <Chip key={k} selected={d.kind === k} onClick={() => edit(i, { kind: k })}>
                          {k}
                        </Chip>
                      ))}
                    </div>

                    {d.weight_percent !== null && (
                      <span className="tag type-caption">{d.weight_percent}%</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              {warnings.map((w, i) => (
                <p key={i} className="type-note text-t-approaching">
                  {w}
                </p>
              ))}
            </div>
          )}

          {undated > 0 && (
            <p className="type-note text-text-low">
              {undated} of the {keeping} will be added with no date. They appear as work to do,
              not on the calendar, until you give them one.
            </p>
          )}

          {problem && (
            <p className="type-body text-t-overdue" role="alert">
              {problem}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={busy || keeping === 0} onClick={() => void commit()}>
              {busy ? 'Adding' : `Import ${keeping}`}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setDrafts(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
