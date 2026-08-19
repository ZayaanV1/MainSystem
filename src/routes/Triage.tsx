import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import {
  courseVar,
  dismissInboxItem,
  triageToAssignment,
  type AssignmentFields,
  type Course,
  type InboxItem,
} from '../lib/planner';
import { addDays, formatDay, todayKey } from '../lib/time';
import { startBy, urgencyFor } from '../lib/urgency';

/**
 * Triage — turning a captured thought into work.
 *
 * Capture deliberately asks nothing, which means everything it collects lands
 * here eventually. Without a way out the inbox only grows, and an inbox that
 * only grows stops being somewhere you are willing to put things.
 *
 * So the fastest possible path is the default: the captured text is already
 * the title, and "Add it" with nothing else filled in is a valid, complete
 * action. Course, date and effort are all optional — the same rule that
 * governs capture governs the step after it.
 *
 * The original wording is never overwritten. "chem lab report??" is sometimes
 * more informative than the tidy title it became.
 */
export function Triage({
  item,
  courses,
  userId,
  onClose,
  onDone,
}: {
  item: InboxItem;
  courses: Course[];
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fields, setFields] = useState<AssignmentFields>({
    title: item.body,
    course_id: null,
    due_day: null,
    due_time: null,
    effort_minutes: null,
    notes: null,
    remind_at: null,
  });
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AssignmentFields>(key: K, value: AssignmentFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const today = todayKey();
  const canSave = fields.title.trim().length > 0 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setBusy(true);
    try {
      await triageToAssignment(userId, item.id, fields);
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await dismissInboxItem(item.id);
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const previewDue = fields.due_day ? new Date(`${fields.due_day}T12:00:00Z`) : null;
  const urgency = urgencyFor(previewDue, {});
  const start = startBy(previewDue, fields.effort_minutes);

  return (
    <Sheet open onClose={onClose} title="Sort this out">
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Field
          label="What is it"
          value={fields.title}
          onChange={(e) => set('title', e.target.value)}
          autoFocus
        />

        {/* The original wording is kept in view while the title is tidied.
            "chem lab report??" is sometimes more informative than whatever it
            becomes, and it is the only record of what capture actually caught. */}
        {fields.title.trim() !== item.body && (
          // type-note, not type-caption: that style is uppercase, which
          // would rewrite the very thing being preserved. "chem lab report??"
          // shown as "CHEM LAB REPORT??" is no longer what was captured.
          <p className="-mt-4 type-note text-text-low">
            Captured as: {item.body}
          </p>
        )}

        {courses.length > 0 && (
          <div className="flex flex-col gap-3">
            <span className="action-chip type-label">Course</span>
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
          <span className="action-chip type-label">When</span>

          {/* Shortcuts first. Most triage decisions are "today", "tomorrow" or
              "not yet", and making those one tap is the difference between
              triaging the inbox and not. */}
          <div className="flex flex-wrap gap-2">
            <Chip
              selected={fields.due_day === today}
              onClick={() => set('due_day', fields.due_day === today ? null : today)}
            >
              Today
            </Chip>
            <Chip
              selected={fields.due_day === addDays(today, 1)}
              onClick={() =>
                set('due_day', fields.due_day === addDays(today, 1) ? null : addDays(today, 1))
              }
            >
              Tomorrow
            </Chip>
            <Chip
              selected={fields.due_day === addDays(today, 7)}
              onClick={() =>
                set('due_day', fields.due_day === addDays(today, 7) ? null : addDays(today, 7))
              }
            >
              Next week
            </Chip>
            <Chip selected={fields.due_day === null} onClick={() => set('due_day', null)}>
              No date
            </Chip>
          </div>

          <Field
            label="Or pick a day"
            type="date"
            value={fields.due_day ?? ''}
            onChange={(e) => set('due_day', e.target.value || null)}
            hint={fields.due_day ? urgency.label : 'Work with no date is kept, not lost.'}
          />
        </div>

        <Field
          label="Effort, in minutes"
          type="number"
          inputMode="numeric"
          min={1}
          value={fields.effort_minutes ?? ''}
          onChange={(e) => set('effort_minutes', Number(e.target.value) || null)}
          hint={start ? `Start by ${formatDay(start)}` : 'Optional. Used to work out when to start.'}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!canSave}>
            {busy ? 'Adding' : 'Add it'}
          </Button>
          <Button variant="quiet" onClick={() => void dismiss()} disabled={busy}>
            Not needed
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
