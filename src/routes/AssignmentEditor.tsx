import { useEffect, useId, useState, type CSSProperties, type FormEvent } from 'react';
import { rememberOpened } from '../lib/recent';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Sheet } from '../components/Sheet';
import { breakDownTask } from '../lib/assist';
import {
  addSubtask,
  assignmentDueAt,
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
import { formatDay, localDayKey, localHourMinute, todayKey, wallClockToUTC, type DayKey } from '../lib/time';
import { durationLabel } from '../lib/blocks';
import {
  REMINDER_CHOICES,
  dayChoices,
  reminderAt,
  reminderLabel,
  reminderMode,
  timeLabel,
  type ReminderMode,
} from '../lib/dueChoices';
import { startBy, urgencyFor } from '../lib/urgency';
import { moduleOn, usePreferences } from '../lib/preferences';

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
 *
 * Laid out as iOS lays out a detail screen (the iPhone review, 12 Oct 2026):
 * Close and Save across the top, the title large, then grouped rows with the
 * label on the left and the value on the right. Course, Remind and Effort
 * open the system's own picker; Due opens in place, with the quick days and
 * then the date and time side by side. It was three rows of chips that
 * scrolled sideways, a summary card, and a time field that ran off the edge.
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
    weight_percent: a.weight_percent,
    grade_percent: a.grade_percent,
    link: a.link,
  };
}

/** The usual sizes of a piece of work. Any other stored value is offered too. */
const EFFORTS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];

const chevron = (
  <svg aria-hidden className="cell-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export function AssignmentEditor({
  open,
  assignment,
  courses,
  subtasks = [],
  userId,
  onClose,
  onSaved,
  url,
}: {
  /** The address while open: "?work=<id>" on the current screen. */
  url?: string;
  open: boolean;
  assignment: Assignment;
  courses: Course[];
  subtasks?: Subtask[];
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [opened] = useState<AssignmentFields>(() => fromAssignment(assignment));
  // Offered back by an empty Search. Recorded here because every way into a
  // piece of work, from any screen, comes through this sheet.
  useEffect(() => {
    rememberOpened({ id: assignment.id, title: assignment.title });
  }, [assignment.id, assignment.title]);
  const [fields, setFields] = useState<AssignmentFields>(opened);
  const gradesOn = moduleOn('grades', usePreferences());
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Due, opened in place: the quick days and the date and time fields.
  const [dueOpen, setDueOpen] = useState(false);
  const [remind, setRemind] = useState<ReminderMode>(() => reminderMode(assignment.remind_at, fields.due_day));
  const formId = useId();

  const today = todayKey();

  const set = <K extends keyof AssignmentFields>(key: K, value: AssignmentFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  /*
   * A reminder chosen relative to the deadline follows it: move the due day
   * and "day before" moves too. Computed into the same single remind_at.
   */
  const setDueDay = (day: DayKey | null) => {
    setFields((f) => {
      const relative = remind !== 'none' && remind !== 'exact';
      return {
        ...f,
        due_day: day,
        due_time: day ? f.due_time : null,
        remind_at: relative ? reminderAt(remind, day) : day || remind === 'exact' ? f.remind_at : null,
      };
    });
    if (!day && remind !== 'exact') setRemind('none');
  };

  const chooseReminder = (mode: ReminderMode) => {
    setRemind(mode);
    if (mode === 'none') set('remind_at', null);
    else if (mode === 'exact') set('remind_at', fields.remind_at ?? (fields.due_day ? fromLocalInput(`${fields.due_day}T16:00`) : null));
    else set('remind_at', reminderAt(mode, fields.due_day));
  };

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

  // Previewed live, at the real instant it will be stored at, so the row
  // cannot disagree with the list it came from.
  const previewDue = fields.due_day
    ? new Date(assignmentDueAt(fields.due_day, fields.due_time) as string)
    : null;
  const urgency = urgencyFor(previewDue, { done: assignment.status === 'done' });
  const start: DayKey | null = startBy(previewDue, fields.effort_minutes, assignment.start_by_override);

  const days = dayChoices(today, fields.due_day, opened.due_day);
  const course = courses.find((c) => c.id === fields.course_id);
  const cv = courseVar(course?.colour_index);
  const efforts = [...new Set([...EFFORTS, ...(fields.effort_minutes ? [fields.effort_minutes] : [])])].sort((a, b) => a - b);

  return (
    <Sheet
      dock
      open={open}
      onClose={onClose}
      title={assignment.title || 'Edit work'}
      // The title is edited where it is read: the row's title flies into
      // this field (Phase B), and there is no second Title field below it.
      titleInput={{ value: fields.title, onChange: (v) => set('title', v), label: 'Title' }}
      flightFrom={`[data-row="${CSS.escape(assignment.id)}"] .slip-title`}
      url={url}
      bar={
        <button type="submit" form={formId} className="bar-btn" data-tone="strong" disabled={!canSave}>
          {saving ? 'Saving' : 'Save'}
        </button>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <div className="cells">
          {courses.length > 0 && (
            <label className="cell">
              Course
              <span className="cell-v" data-tone={course ? undefined : 'low'}>
                {cv && <span aria-hidden data-block className="chip-dot" style={{ '--b': `var(${cv}-rgb)` } as CSSProperties} />}
                {course ? (course.code ?? course.name) : 'None'}
              </span>
              {chevron}
              <select
                className="cell-sel"
                aria-label="Course"
                value={fields.course_id ?? ''}
                onChange={(e) => set('course_id', e.target.value || null)}
              >
                <option value="">None</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ?? c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* The deadline, read back with its urgency in words; a tap opens
              the ways to change it, in place. */}
          <button
            type="button"
            className="cell"
            aria-expanded={dueOpen}
            aria-controls={`${formId}-due`}
            onClick={() => setDueOpen(!dueOpen)}
          >
            Due
            <span className="cell-v" data-tone={fields.due_day ? undefined : 'low'} aria-live="polite">
              {fields.due_day
                ? `${formatDay(fields.due_day)}${fields.due_time ? ` · ${timeLabel(fields.due_time)}` : ''}`
                : 'No date'}
              {fields.due_day && (
                <span className="font-semibold" style={{ color: `var(${urgency.colourVar})` }}>
                  {urgency.label}
                </span>
              )}
            </span>
            {chevron}
          </button>
          {dueOpen && (
            <div id={`${formId}-due`} className="cell-x enter-fade">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick days">
                {days.map((c) => (
                  <Chip key={c.day} selected={fields.due_day === c.day} onClick={() => setDueDay(c.day)}>
                    {c.label}
                  </Chip>
                ))}
                <Chip selected={fields.due_day === null} onClick={() => setDueDay(null)}>
                  No date
                </Chip>
              </div>
              <div className="cell-dt">
                <input
                  type="date"
                  aria-label="Due day"
                  value={fields.due_day ?? ''}
                  onChange={(e) => setDueDay(e.target.value || null)}
                />
                <input
                  type="time"
                  aria-label="Due time"
                  disabled={!fields.due_day}
                  value={fields.due_time ?? ''}
                  onChange={(e) => set('due_time', e.target.value || null)}
                />
              </div>
              <p className="type-note text-text-low">Clear the time to make it due at the end of the day.</p>
            </div>
          )}

          <label className="cell">
            Remind
            <span className="cell-v" data-tone={remind === 'none' ? 'low' : undefined}>
              {remind === 'exact' && fields.remind_at
                ? reminderLabel(fields.remind_at, today)
                : REMINDER_CHOICES.find((r) => r.mode === remind)?.label}
            </span>
            {chevron}
            <select
              className="cell-sel"
              aria-label="Remind"
              value={remind}
              onChange={(e) => chooseReminder(e.target.value as ReminderMode)}
            >
              {REMINDER_CHOICES.map((r) => (
                // Relative reminders need a deadline to be relative to.
                <option key={r.mode} value={r.mode} disabled={r.mode !== 'none' && r.mode !== 'exact' && !fields.due_day}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {remind === 'exact' && (
            <div className="cell-x">
              <div className="cell-dt" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
                <input
                  type="datetime-local"
                  aria-label="Remind at"
                  value={fields.remind_at ? toLocalInput(fields.remind_at) : ''}
                  onChange={(e) => set('remind_at', e.target.value ? fromLocalInput(e.target.value) : null)}
                />
              </div>
              <p className="type-note text-text-low">One reminder, at that moment. Silent once the work is done.</p>
            </div>
          )}

          {start && (
            <div className="cell">
              Start by
              <span className="cell-v" data-tone="low">
                {formatDay(start)}
              </span>
            </div>
          )}
        </div>

        <Subtasks
          assignmentId={assignment.id}
          userId={userId}
          subtasks={subtasks}
          title={fields.title}
          courseName={course?.name ?? null}
          notes={fields.notes}
          onChanged={onSaved}
        />

        {/*
          Effort, weight and mark are all optional: the weight usually arrives
          from the syllabus and the mark weeks later, and a screen that
          demanded either would be demanding a fact nobody has yet.
        */}
        <div className="cells">
          <label className="cell">
            Effort
            <span className="cell-v" data-tone={fields.effort_minutes ? undefined : 'low'}>
              {fields.effort_minutes ? durationLabel(fields.effort_minutes) : 'Not set'}
            </span>
            {chevron}
            <select
              className="cell-sel"
              aria-label="Effort"
              value={fields.effort_minutes ?? ''}
              onChange={(e) => set('effort_minutes', Number(e.target.value) || null)}
            >
              <option value="">Not set</option>
              {efforts.map((m) => (
                <option key={m} value={m}>
                  {durationLabel(m)}
                </option>
              ))}
            </select>
          </label>

          {gradesOn && (
            <>
              <label className="cell">
                Worth
                <span className="cell-v">
                  <input
                    className="cell-in cell-num"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.5"
                    placeholder="Not set"
                    value={fields.weight_percent ?? ''}
                    onChange={(e) => set('weight_percent', Number(e.target.value) || null)}
                  />
                  {fields.weight_percent != null && <span className="cell-unit">% of grade</span>}
                </span>
              </label>
              <label className="cell">
                Scored
                <span className="cell-v">
                  <input
                    className="cell-in cell-num"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.5"
                    placeholder="Not yet"
                    value={fields.grade_percent ?? ''}
                    // 0 is a real mark. `Number(v) || null` turned it into
                    // "not marked". (A weight of 0 stays empty: the database
                    // requires a weight above 0.)
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      const n = Number(v);
                      set('grade_percent', v === '' || !Number.isFinite(n) ? null : n);
                    }}
                  />
                  {fields.grade_percent != null && <span className="cell-unit">%</span>}
                </span>
              </label>
            </>
          )}

          <div className="cell">
            <label htmlFor={`${formId}-link`} className="shrink-0">
              Link
            </label>
            <input
              id={`${formId}-link`}
              className="cell-in text-right"
              // Text with a URL keyboard, not type="url": the browser's own
              // check refused "moodle.example.edu/…" and blocked Save.
              // normaliseLink adds https:// and drops anything that is not a
              // web address.
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={fields.link ?? ''}
              onChange={(e) => set('link', e.target.value || null)}
              placeholder="The brief, the submission page"
            />
            {/* The row no longer carries the link, so it opens from here:
                an anchor, so it behaves like one. */}
            {assignment.link && (
              <a href={assignment.link} target="_blank" rel="noreferrer noopener" className="bar-btn -mr-2 shrink-0">
                Open
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col">
          <label htmlFor={`${formId}-notes`} className="cells-h">
            Notes
          </label>
          <div className="cells">
            <textarea
              id={`${formId}-notes`}
              rows={3}
              className="cell-notes"
              placeholder="Anything worth keeping"
              value={fields.notes ?? ''}
              onChange={(e) => set('notes', e.target.value || null)}
            />
          </div>
        </div>

        {/* Two taps, because this one cannot be undone. Not a modal on top of
            a modal — the confirmation replaces the row in place. */}
        <div className="cells">
          {confirmingDelete ? (
            <>
              <button type="button" className="cell cell-end" onClick={() => void remove()}>
                Delete for good
              </button>
              <button type="button" className="cell cell-end text-text-mid" onClick={() => setConfirmingDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="cell cell-end text-text-mid" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
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
    <div className="flex flex-col">
      <p className="cells-h">
        Steps{mine.length > 0 && `, ${mine.filter((s) => s.done).length} of ${mine.length} done`}
      </p>

      <div className="cells">
        {mine.map((s) => (
          <div key={s.id} className="cell gap-0 pr-0 pl-0">
            <button
              type="button"
              className="flex min-h-[var(--tap)] min-w-0 flex-1 items-center gap-3 self-stretch pl-4 text-left"
              onClick={() => void setSubtaskDone(s.id, !s.done).then(onChanged)}
              aria-pressed={s.done}
              aria-label={s.done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
            >
              {/* The app's one tick, as on the checklist and the rows. */}
              <span aria-hidden className="tick" data-done={s.done || undefined}>
                {s.done && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3">
                    <path
                      d="M2.5 6.2 L4.8 8.5 L9.5 3.8"
                      fill="none"
                      stroke="var(--ink-900)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className={`type-body ${s.done ? 'text-text-low line-through decoration-text-low' : 'text-text-hi'}`}>
                {s.title}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void deleteSubtask(s.id).then(onChanged)}
              aria-label={`Remove "${s.title}"`}
              className="grid min-h-[var(--tap)] w-12 shrink-0 place-items-center text-text-low"
            >
              <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}

        <div className="cell">
          <input
            value={draft}
            aria-label="Add a step"
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              // Enter adds the step without submitting the whole form, so several
              // can be typed in a row.
              if (ev.key === 'Enter') {
                ev.preventDefault();
                void add();
              }
            }}
            placeholder="Add a first move"
            className="cell-in"
          />
          {draft.trim() && (
            <button type="button" className="bar-btn -mr-2 shrink-0" onClick={() => void add()}>
              Add
            </button>
          )}
        </div>

        {/*
          The paralysis button. "Write research paper" is the thing you cannot
          start; four concrete first moves is the thing you can. Suggestions
          are shown and not written, and keeping them appends.
        */}
        {suggested === null && (
          <button
            type="button"
            className="cell cell-act"
            onClick={() => void suggest()}
            disabled={thinking || !title.trim()}
          >
            {thinking ? 'Working it out' : 'Break this into first moves'}
          </button>
        )}
      </div>

      {suggested !== null && (
        <div className="mt-3 flex flex-col gap-3 rounded-card border border-ink-600 p-3">
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
                  <span className="type-note text-text-low">{step.minutes} min</span>
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
        <p className="mt-2 px-4 type-body text-t-overdue" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
