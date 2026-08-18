import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import {
  courseVar,
  deleteAssignment,
  updateAssignment,
  type Assignment,
  type AssignmentFields,
  type Course,
} from '../lib/planner';
import { localDayKey, localHourMinute, type DayKey } from '../lib/time';
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
  };
}

export function AssignmentEditor({
  open,
  assignment,
  courses,
  onClose,
  onSaved,
}: {
  open: boolean;
  assignment: Assignment;
  courses: Course[];
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
            <span className="type-label text-text-mid">Course</span>
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

        <Field
          label="Effort, in minutes"
          type="number"
          inputMode="numeric"
          min={1}
          value={fields.effort_minutes ?? ''}
          onChange={(e) => set('effort_minutes', Number(e.target.value) || null)}
          hint={start ? `Start by ${start}` : 'Used to work out when to start.'}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="notes" className="type-label text-text-mid">
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
