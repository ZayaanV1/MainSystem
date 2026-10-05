import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
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
import { closeUp, measureBelow } from '../lib/motion';
import {
  REMINDER_CHOICES,
  TIME_CHOICES,
  dayChoices,
  reminderAt,
  reminderLabel,
  reminderMode,
  timeLabel,
  type ReminderMode,
} from '../lib/dueChoices';
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
    weight_percent: a.weight_percent,
    grade_percent: a.grade_percent,
    link: a.link,
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
  const [opened] = useState<AssignmentFields>(() => fromAssignment(assignment));
  const [fields, setFields] = useState<AssignmentFields>(opened);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The exact pickers, behind their chips: shown when chosen, or when the
  // stored value is one no chip names.
  const [pickingDay, setPickingDay] = useState(false);
  const [pickingTime, setPickingTime] = useState(
    () => fields.due_time !== null && !TIME_CHOICES.includes(fields.due_time),
  );
  const [remind, setRemind] = useState<ReminderMode>(() => reminderMode(assignment.remind_at, fields.due_day));
  const [more, setMore] = useState(false);
  const moreFollowers = useRef<Map<HTMLElement, number> | null>(null);
  useLayoutEffect(() => {
    if (!moreFollowers.current) return;
    closeUp(moreFollowers.current);
    moreFollowers.current = null;
  }, [more]);

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

  // Previewed live, at the real instant it will be stored at, so the summary
  // cannot disagree with the row it came from.
  const previewDue = fields.due_day
    ? new Date(assignmentDueAt(fields.due_day, fields.due_time) as string)
    : null;
  const urgency = urgencyFor(previewDue, { done: assignment.status === 'done' });
  const start: DayKey | null = startBy(previewDue, fields.effort_minutes, assignment.start_by_override);

  // What More details holds, said in a line so it need not be opened to know.
  const detailSummary = [
    fields.effort_minutes ? durationLabel(fields.effort_minutes) : null,
    typeof fields.weight_percent === 'number' ? `${fields.weight_percent}%` : null,
    typeof fields.grade_percent === 'number' ? `scored ${fields.grade_percent}%` : null,
    fields.link ? 'link' : null,
    fields.notes?.trim() ? 'notes' : null,
  ].filter(Boolean);

  const days = dayChoices(today, fields.due_day, opened.due_day);

  return (
    <Sheet
      dock
      open={open}
      onClose={onClose}
      title={assignment.title || 'Edit work'}
      // The title is edited where it is read: the slip's title flies into
      // this field (Phase B), and there is no second Title field below it.
      titleInput={{ value: fields.title, onChange: (v) => set('title', v), label: 'Title' }}
      flightFrom={`[data-row="${CSS.escape(assignment.id)}"] .slip-title`}
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        {courses.length > 0 && (
          <div className="chip-row" role="group" aria-label="Course">
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
        )}

        {/* The deadline, read back. The chips below set it; this says what
            they set, with its urgency in words beside it. */}
        <div className="ed-sum" aria-live="polite">
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-low">
            <rect x="3.5" y="5" width="17" height="15" rx="3" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <span className="ed-sum-when">
            <b>
              {fields.due_day
                ? `${longDay(fields.due_day)}, ${fields.due_time ? timeLabel(fields.due_time) : 'end of day'}`
                : 'No date yet'}
            </b>
            {(start || fields.remind_at) && (
              <span>
                {[
                  start ? `Start by ${formatDay(start)}` : null,
                  fields.remind_at ? `Reminder ${reminderLabel(fields.remind_at, today)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </span>
          {fields.due_day && (
            <span className="ed-sum-urg" style={{ color: `var(${urgency.colourVar})` }}>
              {urgency.label}
            </span>
          )}
        </div>

        <div className="ed-row">
          <span className="kicker" id="due-label">
            Due
          </span>
          <div className="chip-row" role="group" aria-labelledby="due-label">
            {days.map((c) => (
              <Chip
                key={c.day}
                selected={!pickingDay && fields.due_day === c.day}
                onClick={() => {
                  setPickingDay(false);
                  setDueDay(c.day);
                }}
              >
                {c.label}
              </Chip>
            ))}
            <Chip selected={pickingDay} onClick={() => setPickingDay(!pickingDay)}>
              Pick a date
            </Chip>
            <Chip
              selected={!pickingDay && fields.due_day === null}
              onClick={() => {
                setPickingDay(false);
                setDueDay(null);
              }}
            >
              No date
            </Chip>
          </div>
          {pickingDay && (
            <Field
              label="Date"
              type="date"
              value={fields.due_day ?? ''}
              onChange={(e) => setDueDay(e.target.value || null)}
              autoFocus
            />
          )}

          {fields.due_day && (
            <div className="chip-row" role="group" aria-label="Due time">
              {TIME_CHOICES.map((t) => (
                <Chip
                  key={t ?? 'eod'}
                  selected={!pickingTime && fields.due_time === t}
                  onClick={() => {
                    setPickingTime(false);
                    set('due_time', t);
                  }}
                >
                  {timeLabel(t)}
                </Chip>
              ))}
              <Chip selected={pickingTime} onClick={() => setPickingTime(!pickingTime)}>
                {pickingTime && fields.due_time ? timeLabel(fields.due_time) : 'Exact time'}
              </Chip>
            </div>
          )}
          {fields.due_day && pickingTime && (
            <Field
              label="Time"
              type="time"
              value={fields.due_time ?? ''}
              onChange={(e) => set('due_time', e.target.value || null)}
              hint="Empty means the end of that day."
            />
          )}
        </div>

        <div className="ed-row">
          <span className="kicker" id="remind-label">
            Remind me
          </span>
          <div className="chip-row" role="group" aria-labelledby="remind-label">
            {REMINDER_CHOICES.map((r) => {
              // Relative reminders need a deadline to be relative to.
              // Disabled in place rather than removed, so the row never
              // shifts under the finger when the date is cleared.
              const needsDay = r.mode !== 'none' && r.mode !== 'exact';
              return (
                <Chip
                  key={r.mode}
                  selected={remind === r.mode}
                  disabled={needsDay && !fields.due_day}
                  onClick={() => chooseReminder(r.mode)}
                >
                  {r.label}
                </Chip>
              );
            })}
          </div>
          {remind === 'exact' && (
            <Field
              label="Reminder"
              type="datetime-local"
              value={fields.remind_at ? toLocalInput(fields.remind_at) : ''}
              onChange={(e) => set('remind_at', e.target.value ? fromLocalInput(e.target.value) : null)}
              hint="One reminder, at that moment. Silent once the work is done."
            />
          )}
        </div>

        <Subtasks
          assignmentId={assignment.id}
          userId={userId}
          subtasks={subtasks}
          title={fields.title}
          courseName={courses.find((c) => c.id === fields.course_id)?.name ?? null}
          notes={fields.notes}
          onChanged={onSaved}
        />

        {/*
          The rarer fields, folded, with what they hold said on the fold so it
          need not be opened to be known. Effort, weight and mark are all
          optional: the weight usually arrives from the syllabus and the mark
          weeks later, and a screen that demanded either would be demanding a
          fact nobody has yet.
        */}
        <div className="flex flex-col gap-4">
          <button
            type="button"
            className="ed-more"
            aria-expanded={more}
            aria-controls="more-details"
            onClick={(e) => {
              moreFollowers.current = measureBelow(e.currentTarget);
              setMore(!more);
            }}
          >
            More details
            <span className="ed-more-sum">
              {detailSummary.length > 0 && <span>{detailSummary.join(' · ')}</span>}
              <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>

          {more && (
            <div id="more-details" className="enter-fade flex flex-col gap-5">
              <Field
                label="Effort, in minutes"
                type="number"
                inputMode="numeric"
                min={1}
                value={fields.effort_minutes ?? ''}
                onChange={(e) => set('effort_minutes', Number(e.target.value) || null)}
                hint={start ? `Start by ${formatDay(start)}` : 'Used to work out when to start.'}
              />

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Worth"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  value={fields.weight_percent ?? ''}
                  onChange={(e) => set('weight_percent', Number(e.target.value) || null)}
                  hint="% of the course grade"
                />
                <Field
                  label="Scored"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  value={fields.grade_percent ?? ''}
                  // 0 is a real mark. `Number(v) || null` turned it into
                  // "not marked". (A weight of 0 stays empty: the database
                  // requires a weight above 0.)
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    const n = Number(v);
                    set('grade_percent', v === '' || !Number.isFinite(n) ? null : n);
                  }}
                  hint="% you got, once marked"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Field
                  label="Where it lives"
                  // Text with a URL keyboard, not type="url": the browser's own
                  // check refused "moodle.example.edu/…", the very form the
                  // placeholder suggests, and blocked Save. normaliseLink adds
                  // https:// and drops anything that is not a web address.
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={fields.link ?? ''}
                  onChange={(e) => set('link', e.target.value || null)}
                  placeholder="moodle.example.edu/mod/assign/…"
                  hint="The submission page, the brief, the doc. Optional."
                />
                {/* The ticket no longer carries the link, so it opens from
                    here: an anchor, so it behaves like one. */}
                {assignment.link && (
                  <a
                    href={assignment.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn btn-quiet self-start px-4 type-label"
                  >
                    Open the link
                  </a>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="notes" className="kicker">
                  Notes
                </label>
                <textarea
                  id="notes"
                  rows={3}
                  value={fields.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value || null)}
                  className="well p-4 type-body text-text-hi placeholder:text-text-low"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!canSave} className="flex-1">
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

/** "Wed 7 Oct" for the summary line. */
function longDay(day: DayKey): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(new Date(`${day}T12:00:00Z`))
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month}`;
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
      <span className="kicker">
        Steps{mine.length > 0 && ` — ${mine.filter((s) => s.done).length} of ${mine.length}`}
      </span>

      {mine.length > 0 && (
        <div className="mat overflow-hidden">
          {mine.map((s) => (
            <div key={s.id} className="flex items-center border-b border-ink-600 last:border-b-0">
              <Pressable className="flex-1 gap-3 px-4"
                onClick={() => void setSubtaskDone(s.id, !s.done).then(onChanged)}
                aria-pressed={s.done}
                aria-label={s.done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}>
                {/* The app's one tick, as on the checklist and the tickets. */}
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
              </Pressable>

              <button
                type="button"
                onClick={() => void deleteSubtask(s.id).then(onChanged)}
                aria-label={`Remove "${s.title}"`}
                // Deliberately NOT the Button primitive. Sized to its label
                // rather than a fixed box: 'Remove' is wider than 44px and was
                // being clipped. Routing it through Button would mean passing
                // classes that undo Button's own padding and border, which is
                // a primitive being fought rather than used. Height still meets
                // the tap floor and it carries fx-depth like everything else.
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
          className="well flex-1 type-body text-text-hi placeholder:text-text-low"
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
