import { useState, type FormEvent } from 'react';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import { breakDownTask } from '../lib/assist';
import {
  addSubtask,
  courseVar,
  deleteAssignment,
  deleteSubtask,
  setSubtaskDone,
  updateAssignment,
  type Assignment,
  type AssignmentFields,
  type Course,
  type Subtask,
} from '../lib/planner';
import { formatDay, localDayKey, localHourMinute, wallClockToUTC, type DayKey } from '../lib/time';
import { startBy, urgencyFor } from '../lib/urgency';

/**
 * Edit one assignment.
 *
 * Only the title is required, and clearing the date is a normal thing to do
 * rather than an error — work you cannot schedule yet is still work worth
 * keeping, and refusing to store it is how it ends up nowhere.
 *
 * The derived start-by date is shown, not editable. It is a consequence of the
 * due date and the effort estimate; letting it be typed directly would make it
 * a third number to keep in sync with the other two.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * datetime-local speaks in the browser's own zone, which for this app is
 * always Montreal. Converting through the shared time layer rather than the
 * Date constructor keeps the stored instant correct on both sides of a DST
 * change.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const day = localDayKey(d);
  const hm = localHourMinute(d);
  return `${day}T${pad(hm.hour)}:${pad(hm.minute)}`;
}

function fromLocalInput(value: string): string {
  const [day, time] = value.split('T');
  const [h, m] = time.split(':').map(Number);
  return wallClockToUTC(day, h, m).toISOString();
}

function fromAssignment(a: Assignment): AssignmentFields {
  const due = a.due_at ? new Date(a.due_at) : null;
  const hm = due && a.due_has_time ? localHourMinute(due) : null;

  return {
    title: a.title,
    course_id: a.course_id,
    due_day: due ? localDayKey(due) : null,
    due_time: hm ? `${pad(hm.hour)}:${pad(hm.minute)}` : null,
    effort_minutes: a.effort_minutes,
    notes: a.notes,
    remind_at: a.remind_at,
  };
}

export function AssignmentEditor({
  open,
  assignment,
  courses,
  subtasks = [],
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  assignment: Assignment;
  courses: Course[];
  subtasks?: Subtask[];
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<AssignmentFields>(() => fromAssignment(assignment));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const set = <K extends keyof AssignmentFields>(key: K, value: AssignmentFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const canSave = fields.title.trim().length > 0 && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    try {
      await updateAssignment(assignment.id, fields);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await deleteAssignment(assignment.id);
    onSaved();
    onClose();
  }

  // Previewed live, so the effect of an effort estimate is visible while it is
  // being typed rather than discovered later on the Today screen.
  const previewDue = fields.due_day
    ? new Date(`${fields.due_day}T12:00:00Z`)
    : null;
  const urgency = urgencyFor(previewDue, { done: assignment.status === 'done' });
  const start: DayKey | null = startBy(previewDue, fields.effort_minutes);

  return (
    <Sheet open={open} onClose={onClose} title="Edit work">
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Field
          label="Title"
          value={fields.title}
          onChange={(e) => set('title', e.target.value)}
          autoFocus
        />

        {courses.length > 0 && (
          <div className="flex flex-col gap-3">
            <span className="tag type-label">Course</span>
            <div className="flex flex-wrap gap-2">
              {courses.map((c) => (
                <Chip
                  key={c.id}
                  courseVar={courseVar(c.colour_index)}
                  selected={fields.course_id === c.id}
                  onClick={() => set('course_id', fields.course_id === c.id ? null : c.id)}
                >
                  {c.code ?? c.name}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Field
            label="Due"
            type="date"
            value={fields.due_day ?? ''}
            onChange={(e) => set('due_day', e.target.value || null)}
            hint={fields.due_day ? urgency.label : 'Leave empty if there is no date yet.'}
          />

          {fields.due_day && (
            <Field
              label="Time"
              type="time"
              value={fields.due_time ?? ''}
              onChange={(e) => set('due_time', e.target.value || null)}
              hint="Optional. Empty means the end of that day."
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Field
            label="Remind me"
            type="datetime-local"
            value={fields.remind_at ? toLocalInput(fields.remind_at) : ''}
            onChange={(e) =>
              set('remind_at', e.target.value ? fromLocalInput(e.target.value) : null)
            }
            hint="Optional. One reminder, at that moment. Silent once the work is done."
          />

          {fields.due_day && !fields.remind_at && (
            <button
              type="button"
              onClick={() =>
                set('remind_at', fromLocalInput(`${fields.due_day}T16:00`))
              }
              className="fx-depth self-start type-caption text-text-mid"
            >
              Use 4 p.m. on the due date
            </button>
          )}
        </div>

        <Field
          label="Effort, in minutes"
          type="number"
          inputMode="numeric"
          min={1}
          value={fields.effort_minutes ?? ''}
          onChange={(e) => set('effort_minutes', Number(e.target.value) || null)}
          hint={start ? `Start by ${formatDay(start)}` : 'Used to work out when to start.'}
        />

        <Subtasks
          assignmentId={assignment.id}
          userId={userId}
          subtasks={subtasks}
          title={fields.title}
          courseName={courses.find((c) => c.id === fields.course_id)?.name ?? null}
          notes={fields.notes}
          onChanged={onSaved}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="notes" className="action-chip type-label">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            value={fields.notes ?? ''}
            onChange={(e) => set('notes', e.target.value || null)}
            className="w-full rounded-card border border-ink-600 bg-ink-800 p-4 type-body text-text-hi placeholder:text-text-low"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saving ? 'Saving' : 'Save'}
          </Button>

          {/* Two taps, because this one cannot be undone. Not a modal on top of
              a modal — the confirmation replaces the button in place. */}
          {confirmingDelete ? (
            <>
              <Button variant="secondary" onClick={() => void remove()}>
                Delete for good
              </Button>
              <Button variant="quiet" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="quiet" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

/**
 * First moves.
 *
 * "Write research paper" is paralysis; "open a doc and write three possible
 * thesis sentences" is not. This list exists to manufacture the second kind,
 * so adding one asks for a line of text and nothing else — no date, no
 * estimate, no ceremony.
 *
 * Ticking one is not a completion event and gets no celebration. It is a
 * placeholder for where you are, so that picking the work back up tomorrow
 * does not start with rereading everything.
 */
function Subtasks({
  assignmentId,
  userId,
  subtasks,
  title,
  courseName,
  notes,
  onChanged,
}: {
  assignmentId: string;
  userId: string;
  subtasks: Subtask[];
  title: string;
  courseName: string | null;
  notes: string | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [suggested, setSuggested] = useState<{ title: string; minutes: number }[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mine = subtasks
    .filter((s) => s.assignment_id === assignmentId)
    .sort((a, b) => a.position - b.position);

  async function add() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await addSubtask(userId, assignmentId, text, mine.length);
    onChanged();
  }

  async function suggest() {
    setThinking(true);
    setProblem(null);
    setSuggested(null);

    const result = await breakDownTask({ title, courseName, notes });
    setThinking(false);

    if (!result.ok) {
      setProblem(result.reason);
      return;
    }

    setSuggested(result.steps);
    setWarnings(result.warnings);
  }

  /**
   * Accepts the suggestion.
   *
   * Written one at a time and appended after whatever is already there, so a
   * breakdown never silently replaces steps that were typed by hand.
   */
  async function keep(steps: { title: string; minutes: number }[]) {
    let position = mine.length;
    for (const step of steps) {
      await addSubtask(userId, assignmentId, step.title, position);
      position += 1;
    }
    setSuggested(null);
    setWarnings([]);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="tag type-label">
        Steps{mine.length > 0 && ` — ${mine.filter((s) => s.done).length} of ${mine.length}`}
      </span>

      {mine.length > 0 && (
        <div className="overflow-hidden rounded-card bg-ink-800">
          {mine.map((s) => (
            <div key={s.id} className="flex items-center border-b border-ink-600 last:border-b-0">
              <Pressable className="flex-1 gap-3 px-4"
                onClick={() => void setSubtaskDone(s.id, !s.done).then(onChanged)}
                aria-pressed={s.done}
                aria-label={s.done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}>
                <span
                  aria-hidden
                  className={[
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border-2',
                    s.done ? 'border-t-done bg-t-done' : 'border-ink-600',
                  ].join(' ')}
                />
                <span className={`type-body ${s.done ? 'text-text-low' : 'text-text-hi'}`}>
                  {s.title}
                </span>
              </Pressable>

              <button
                type="button"
                onClick={() => void deleteSubtask(s.id).then(onChanged)}
                aria-label={`Remove "${s.title}"`}
                // Sized to its label rather than a fixed 44px box: 'Remove' is wider
                // than that and was being clipped. Height still meets the tap floor.
                className="fx-depth flex min-h-[var(--tap)] shrink-0 items-center px-4 type-caption text-text-low"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            // Enter adds the step without submitting the whole form, so several
            // can be typed in a row.
            if (ev.key === 'Enter') {
              ev.preventDefault();
              void add();
            }
          }}
          placeholder="A first move"
          className="flex-1 rounded-card border border-ink-600 bg-ink-800 px-4 type-body text-text-hi placeholder:text-text-low"
        />
        <Button onClick={() => void add()} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      {/*
        The paralysis button. "Write research paper" is the thing you cannot
        start; four concrete first moves is the thing you can.

        Suggestions are shown and not written, same as everywhere else, and
        accepting them appends rather than replaces — a breakdown must never
        quietly delete steps that were typed by hand.
      */}
      {suggested === null ? (
        <div>
          <Button
            variant="quiet"
            onClick={() => void suggest()}
            disabled={thinking || !title.trim()}
          >
            {thinking ? 'Working it out' : 'Break this into first moves'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-card border border-ink-600 p-3">
          <p className="type-note text-text-low">
            Nothing is added until you keep these. Remove any that are wrong.
          </p>

          <div className="flex flex-col">
            {suggested.map((step, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3 border-b border-ink-600 py-2 last:border-b-0"
              >
                <span className="type-body text-text-hi">{step.title}</span>
                <div className="flex shrink-0 items-baseline gap-3">
                  <span className="tag type-caption">{step.minutes} min</span>
                  <Button variant="quiet" size="sm"
                    onClick={() => setSuggested((list) => (list ?? []).filter((_, n) => n !== i))}>
                    Drop
                  </Button>
                </div>
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

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              onClick={() => void keep(suggested)}
              disabled={suggested.length === 0}
            >
              Keep {suggested.length === 1 ? 'it' : `these ${suggested.length}`}
            </Button>
            <Button variant="quiet" onClick={() => { setSuggested(null); setWarnings([]); }}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {problem && (
        <p className="type-body text-t-overdue" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
