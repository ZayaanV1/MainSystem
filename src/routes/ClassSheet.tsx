import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import { tint } from '../components/calendar/items';
import { courseVar, type Course } from '../lib/planner';
import {
  coursePrefix,
  deleteClass,
  saveClass,
  sessionCounts,
  titleName,
  type ClassSeries,
  type ClassSummary,
} from '../lib/classes';
import {
  MAX_CLASSES,
  classDays,
  clockChanges,
  clockMinutes,
  describeDays,
  meetingDays,
  planClass,
  sessionOn,
  type ClassPattern,
} from '../../supabase/functions/_shared/classes';
import { activeTimezone, addDays, formatDay, formatTime, formatTimeRange, isoWeekday, todayKey, type DayKey } from '../lib/time';
import '../styles/classes.css';

/**
 * Adding a class by hand, and changing, ending or deleting one.
 *
 * For a student whose school gives no calendar file. The form asks only what
 * a timetable says — days, times, room, the term — and the course's code is a
 * fixed prefix of the name, so "COEN 231 Lecture" is what Search, Abood and a
 * subscribed phone calendar read.
 *
 * THE PREVIEW IS THE SAME FUNCTION AS THE WRITE
 *
 * Every date is drawn before anything is saved (rule 6), by `meetingDays` and
 * `planClass` — the calls the save makes — so the count on the button is the
 * number of rows about to appear. Tapping a date skips it: reading week, a
 * holiday, a lecture that was cancelled. A clock change inside the term is
 * named, with the reassurance that the class keeps its time, because each
 * session is converted from its own date.
 *
 * AN EDIT SAYS WHAT IT WILL DO
 *
 * Changes apply from a day (today unless moved). The preview becomes a count
 * of what moves, what is added, what is removed, and how many earlier
 * sessions stay exactly as they were. A class carries no "done" state, so
 * unlike repeating work there is nothing an edit has to guess about.
 */

const WEEKDAYS = [
  { iso: 1, label: 'Mon', name: 'Monday' },
  { iso: 2, label: 'Tue', name: 'Tuesday' },
  { iso: 3, label: 'Wed', name: 'Wednesday' },
  { iso: 4, label: 'Thu', name: 'Thursday' },
  { iso: 5, label: 'Fri', name: 'Friday' },
  { iso: 6, label: 'Sat', name: 'Saturday' },
  { iso: 7, label: 'Sun', name: 'Sunday' },
];

const NAMES = ['Lecture', 'Tutorial', 'Lab', 'Seminar'];

/** Common lengths: a 50-minute slot, the 75-minute pair, a 90, a lab. */
const LENGTHS: [number, string][] = [
  [50, '50 min'],
  [75, '1 h 15'],
  [90, '1 h 30'],
  [165, '2 h 45'],
];

interface Form {
  course_id: string | null;
  name: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  location: string;
  first_day: DayKey;
  last_day: DayKey;
  skip_days: DayKey[];
}

type Part = 'change' | 'end' | 'delete';

interface ClassSheetProps {
  open: boolean;
  onClose: () => void;
  courses: Course[];
  /** The class being changed, or null to add one. */
  editing: ClassSummary | null;
  /** A class already running, whose term a new one starts with. */
  term: ClassSeries | null;
  onSaved: () => void;
}

/** 'HH:MM' that many minutes after another, or '' past midnight. */
function later(start: string, minutes: number): string {
  const m = clockMinutes(start);
  if (m === null || m + minutes >= 24 * 60) return '';
  const t = m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Four months on, for a first class with no earlier one to copy. */
function termEnd(day: DayKey): DayKey {
  return addDays(day, 16 * 7 - 1);
}

function blankForm(term: ClassSeries | null): Form {
  const today = todayKey();
  return {
    course_id: null,
    name: '',
    weekdays: [],
    start_time: '',
    end_time: '',
    location: '',
    first_day: term?.first_day ?? today,
    last_day: term?.last_day ?? termEnd(today),
    skip_days: [],
  };
}

function formOf(series: ClassSeries, course: Course | undefined): Form {
  return {
    course_id: series.course_id,
    name: titleName(series.title, course),
    weekdays: [...series.weekdays],
    start_time: series.start_time,
    end_time: series.end_time,
    location: series.location ?? '',
    first_day: series.first_day,
    last_day: series.last_day,
    skip_days: [...series.skip_days],
  };
}

const patternOf = (f: Form): ClassPattern => ({
  weekdays: f.weekdays,
  start_time: f.start_time,
  end_time: f.end_time,
  first_day: f.first_day,
  last_day: f.last_day,
  skip_days: f.skip_days,
});

/** What stops a form from being saved, said plainly, or null when it can be. */
function whyNot(f: Form, title: string): string | null {
  if (!title) return 'Give it a name.';
  if (f.weekdays.length === 0) return 'Pick at least one day.';
  const start = clockMinutes(f.start_time);
  const end = clockMinutes(f.end_time);
  if (start === null || end === null) return 'Add a start and an end time.';
  if (end <= start) return 'It ends before it starts.';
  if (!f.first_day || !f.last_day) return 'Add the first and last class.';
  if (f.last_day < f.first_day) return 'The last class is before the first.';
  return null;
}

export function ClassSheet({ open, onClose, courses, editing, term, onSaved }: ClassSheetProps) {
  const tz = activeTimezone();
  const today = todayKey();
  const courseOf = (id: string | null) => courses.find((c) => c.id === id);

  const [form, setForm] = useState<Form>(() =>
    editing ? formOf(editing.series, courseOf(editing.series.course_id)) : blankForm(term),
  );
  const [part, setPart] = useState<Part>(editing && !editing.loaded ? 'delete' : 'change');
  const [from, setFrom] = useState<DayKey>(today);
  const [endOn, setEndOn] = useState<DayKey>(() => {
    if (!editing) return today;
    const s = editing.series;
    return today < s.first_day ? s.first_day : today > s.last_day ? s.last_day : today;
  });
  const [alsoPast, setAlsoPast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setError(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const course = courseOf(form.course_id);
  const prefix = coursePrefix(course);
  const title = [prefix, form.name.trim()].filter(Boolean).join(' ');
  const pattern = useMemo(() => patternOf(form), [form]);
  const days = useMemo(() => classDays(pattern), [pattern]);
  const meets = useMemo(() => meetingDays(pattern), [pattern]);
  const changes = useMemo(() => clockChanges(form.first_day, form.last_day, tz), [form.first_day, form.last_day, tz]);
  const why = whyNot(form, title);

  /*
   * The plan the save will send. For a new class it is every meeting; for an
   * edit, what makes the stored sessions match the form from `from` on. It is
   * computed here, once, and the same object is what Save writes.
   */
  const plan = useMemo(() => {
    if (why) return null;
    if (!editing) return planClass([], pattern, form.first_day, tz, false);
    const old = editing.series;
    const refresh =
      title !== old.title || (form.course_id ?? null) !== (old.course_id ?? null) || (form.location.trim() || null) !== (old.location ?? null);
    return planClass(editing.sessions, pattern, from, tz, refresh);
  }, [why, editing, pattern, form.first_day, form.course_id, form.location, title, from, tz]);

  // Ending uses the class as stored, not whatever is half typed in Change.
  const endPlan = useMemo(() => {
    if (!editing || !editing.loaded) return null;
    const s = editing.series;
    if (!endOn || endOn < s.first_day || endOn > s.last_day) return null;
    return planClass(editing.sessions, { ...s, last_day: endOn }, addDays(endOn, 1), tz, false);
  }, [editing, endOn, tz]);

  const now = new Date();
  const counts = editing ? sessionCounts(editing.sessions, now) : { happened: 0, toCome: 0 };

  const seriesOf = (f: Form, id: string): ClassSeries => ({
    id,
    course_id: f.course_id,
    title,
    location: f.location.trim() || null,
    ...patternOf(f),
  });

  const dirty = editing ? !sameClass(seriesOf(form, editing.series.id), editing.series) : true;
  const changesSomething = Boolean(plan && (plan.insert.length || plan.update.length || plan.remove.length));

  async function add() {
    if (!plan) return;
    setSaving(true);
    setError(null);
    const result = await saveClass(seriesOf(form, crypto.randomUUID()), plan);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const n = plan.insert.length;
    setReceipt(`${n} ${n === 1 ? 'class' : 'classes'} added for ${title}. Add another, or close.`);
    // The next class is almost always the same term: keep its dates, and
    // start everything else fresh.
    setForm((f) => ({ ...blankForm(null), first_day: f.first_day, last_day: f.last_day }));
    onSaved();
  }

  async function saveChange() {
    if (!editing || !plan) return;
    setSaving(true);
    setError(null);
    const result = await saveClass(seriesOf(form, editing.series.id), plan);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  async function end() {
    if (!editing || !endPlan) return;
    setSaving(true);
    setError(null);
    const result = await saveClass({ ...editing.series, last_day: endOn }, endPlan);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  async function remove() {
    if (!editing) return;
    const t = now.getTime();
    const ids = editing.sessions.filter((s) => alsoPast || Date.parse(s.starts_at) >= t).map((s) => s.id);
    setSaving(true);
    setError(null);
    const result = await deleteClass(editing.series.id, ids);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  const n = meets.length;
  const removing = counts.toCome + (alsoPast ? counts.happened : 0);
  const reference = form.start_time && form.end_time && !why ? sessionOn(form.first_day, pattern, tz) : null;
  const when = reference ? formatTimeRange(new Date(reference.starts_at), new Date(reference.ends_at), tz) : null;
  const ids = { course: useId(), name: useId(), days: useId(), kind: useId() };

  return (
    <Sheet open={open} onClose={onClose} title={editing ? editing.series.title : 'Add a class'}>
      <div className="flex flex-col gap-4">
        {editing && editing.loaded && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="What to do with this class">
            {(
              [
                ['change', 'Change it'],
                ['end', 'End it'],
                ['delete', 'Delete it'],
              ] as const
            ).map(([p, label]) => (
              <Button
                key={p}
                size="sm"
                variant={part === p ? 'primary' : 'quiet'}
                aria-pressed={part === p}
                onClick={() => {
                  setError(null);
                  setPart(p);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        {receipt && (
          <p key={receipt} role="status" className="type-note text-t-done enter-fade">
            {receipt}
          </p>
        )}

        {(!editing || part === 'change') && (
          <>
            <div className="flex flex-col gap-2">
              <span id={ids.course} className="kicker">
                Course
              </span>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby={ids.course}>
                {courses
                  .filter((c) => !c.archived || c.id === form.course_id)
                  .map((c) => (
                    <Chip
                      key={c.id}
                      courseVar={courseVar(c.colour_index)}
                      selected={form.course_id === c.id}
                      onClick={() => set('course_id', c.id)}
                    >
                      {c.code ?? c.name}
                    </Chip>
                  ))}
                <Chip selected={form.course_id === null} onClick={() => set('course_id', null)}>
                  No course
                </Chip>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={ids.name} className="kicker">
                Name
              </label>
              <div
                className="well class-name"
                data-block={course ? true : undefined}
                style={tint(course)}
              >
                {prefix && (
                  <span className="class-prefix" aria-hidden>
                    {prefix}
                  </span>
                )}
                <input
                  id={ids.name}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Lecture"
                  autoComplete="off"
                  aria-describedby={prefix ? `${ids.name}-saved` : undefined}
                  className="type-body"
                />
              </div>
              {prefix && (
                <p id={`${ids.name}-saved`} className="type-note text-text-low">
                  Saved as {title || `${prefix} …`}
                </p>
              )}
              <div className="flex flex-wrap gap-2" role="group" aria-label="Common names">
                {NAMES.map((name) => (
                  <Chip key={name} selected={form.name === name} onClick={() => set('name', name)}>
                    {name}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span id={ids.days} className="kicker">
                Days
              </span>
              <div className="class-days" role="group" aria-labelledby={ids.days}>
                {WEEKDAYS.map((d) => {
                  const on = form.weekdays.includes(d.iso);
                  return (
                    <Chip
                      key={d.iso}
                      selected={on}
                      aria-label={d.name}
                      onClick={() =>
                        set('weekdays', on ? form.weekdays.filter((w) => w !== d.iso) : [...form.weekdays, d.iso])
                      }
                    >
                      {d.label}
                    </Chip>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Starts"
                type="time"
                value={form.start_time}
                onChange={(e) => {
                  const next = e.target.value;
                  // Keep the class's length when its start moves: a 10:15 to
                  // 11:30 lecture moved to 10:30 is a 10:30 to 11:45 lecture.
                  const a = clockMinutes(form.start_time);
                  const b = clockMinutes(form.end_time);
                  const length = a !== null && b !== null && b > a ? b - a : null;
                  setError(null);
                  setForm((f) => ({ ...f, start_time: next, end_time: length && next ? later(next, length) || f.end_time : f.end_time }));
                }}
              />
              <Field label="Ends" type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Length">
              {LENGTHS.map(([minutes, label]) => {
                const a = clockMinutes(form.start_time);
                const b = clockMinutes(form.end_time);
                return (
                  <Chip
                    key={minutes}
                    selected={a !== null && b !== null && b - a === minutes}
                    disabled={a === null}
                    onClick={() => set('end_time', later(form.start_time, minutes))}
                  >
                    {label}
                  </Chip>
                );
              })}
            </div>

            <Field
              label="Room"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="H-937"
              autoComplete="off"
              hint="Optional."
            />

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="First class"
                type="date"
                value={form.first_day}
                onChange={(e) => set('first_day', e.target.value)}
              />
              <Field
                label="Last class"
                type="date"
                value={form.last_day}
                onChange={(e) => set('last_day', e.target.value)}
              />
            </div>
            {!editing && term && !receipt && form.first_day === term.first_day && form.last_day === term.last_day && (
              <p className="type-note -mt-2 text-text-low">The term from {term.title}.</p>
            )}

            {editing && (
              <Field
                label="Changes apply from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value || today)}
                hint="Sessions before this day stay exactly as they were."
              />
            )}

            {/*
              The preview. Every date, before anything is written. Rule 6
              applies to a pattern exactly as it does to an extracted
              syllabus, and a timetable you cannot check is one you will not
              trust enough to stop keeping a second copy of.
            */}
            <Card courseVar={courseVar(course?.colour_index)} className="flex flex-col gap-3 p-4">
              {why ? (
                <p className="type-note text-text-mid">{why}</p>
              ) : days.length === 0 ? (
                <p className="type-note text-text-mid">None of those days fall between the first and last class.</p>
              ) : (
                <>
                  {editing && plan ? (
                    <Diff
                      plan={plan}
                      from={from}
                      when={when}
                      room={(form.location.trim() || null) !== (editing.series.location ?? null) ? form.location.trim() : null}
                    />
                  ) : (
                    <div className="flex items-end gap-3">
                      <span className="class-count">{n}</span>
                      <span className="type-note text-text-mid">
                        {n === 1 ? 'class' : 'classes'}, {describeDays(form.weekdays)} {when}
                        <br />
                        {formatDay(days[0])} to {formatDay(days[days.length - 1])}
                      </span>
                    </div>
                  )}

                  {changes.map((c) => {
                    const at = reference ? formatTime(new Date(reference.starts_at), tz) : form.start_time;
                    return (
                      <p key={c.day} className="class-change type-note text-text-hi">
                        Clocks go {c.direction} on {formatDay(c.day)}. Every class stays at {at}
                        {at.endsWith('.') ? '' : '.'}
                      </p>
                    );
                  })}

                  <TermGrid
                    pattern={pattern}
                    days={days}
                    course={course}
                    before={editing ? from : today}
                    pastLabel={editing ? 'before the changes apply' : 'already past'}
                    changes={changes.map((c) => c.day)}
                    onToggle={(d) =>
                      set(
                        'skip_days',
                        form.skip_days.includes(d) ? form.skip_days.filter((s) => s !== d) : [...form.skip_days, d],
                      )
                    }
                  />

                  <p className="type-note text-text-low">
                    Tap a date to skip it.
                    {form.skip_days.length > 0 &&
                      ` ${form.skip_days.length} skipped.`}
                    {!editing && days.some((d) => d < today) &&
                      ' Dates already past are added too, as the record of the term.'}
                  </p>
                  {days.length >= MAX_CLASSES && (
                    <p className="type-note text-t-urgent">
                      That is the most one class can make, so it stops short of {formatDay(form.last_day)}. Bring the
                      last class in, or add the rest as a second class.
                    </p>
                  )}
                </>
              )}
            </Card>
          </>
        )}

        {editing && part === 'end' && (
          <>
            <Field
              label="Last class"
              type="date"
              value={endOn}
              min={editing.series.first_day}
              max={editing.series.last_day}
              onChange={(e) => setEndOn(e.target.value)}
              hint={`It runs until ${formatDay(editing.series.last_day)} now.`}
            />
            <Card className="p-4">
              {endPlan ? (
                <div className="class-diff">
                  <b>{endPlan.remove.length}</b>
                  <span className="type-note text-text-mid">
                    after {formatDay(endOn)} {endPlan.remove.length === 1 ? 'is' : 'are'} removed
                  </span>
                  <b data-quiet>{endPlan.before + endPlan.update.length}</b>
                  <span className="type-note text-text-low">up to then stay</span>
                </div>
              ) : (
                <p className="type-note text-text-mid">
                  {endOn > editing.series.last_day
                    ? 'That is after it already ends. To run it longer, change the last class under Change it.'
                    : 'The last class cannot be before the first.'}
                </p>
              )}
            </Card>
          </>
        )}

        {editing && part === 'delete' && (
          <>
            <Card className="p-4">
              <div className="class-diff">
                <b>{counts.toCome}</b>
                <span className="type-note text-text-mid">still to come, removed</span>
                <b data-quiet>{counts.happened}</b>
                <span className="type-note text-text-low">
                  {editing.loaded ? 'already happened, kept on the calendar' : 'kept on the calendar'}
                </span>
              </div>
            </Card>
            {counts.happened > 0 && (
              <div>
                <Chip selected={alsoPast} onClick={() => setAlsoPast((v) => !v)}>
                  Also remove the {counts.happened} that already happened
                </Chip>
              </div>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="type-note text-t-critical">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!editing && (
            <Button variant="primary" disabled={!plan || n === 0 || saving} onClick={() => void add()}>
              {saving ? 'Adding' : `Add ${n || ''} ${n === 1 ? 'class' : 'classes'}`.replace('  ', ' ')}
            </Button>
          )}
          {editing && part === 'change' && (
            <Button
              variant="primary"
              disabled={!plan || saving || !(dirty || changesSomething)}
              onClick={() => void saveChange()}
            >
              {saving ? 'Saving' : 'Save changes'}
            </Button>
          )}
          {editing && part === 'end' && (
            <Button
              variant="primary"
              disabled={!endPlan || saving || (endPlan.remove.length === 0 && endOn === editing.series.last_day)}
              onClick={() => void end()}
            >
              {saving ? 'Ending' : 'End the class'}
            </Button>
          )}
          {editing && part === 'delete' && (
            <Button variant="primary" disabled={saving} onClick={() => void remove()}>
              {saving
                ? 'Deleting'
                : removing > 0
                  ? `Delete the class and ${removing} ${removing === 1 ? 'session' : 'sessions'}`
                  : 'Delete the class'}
            </Button>
          )}
          <Button variant="quiet" onClick={onClose}>
            {receipt ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Whether two versions of a class say the same thing, whatever order their lists are in. */
function sameClass(a: ClassSeries, b: ClassSeries): boolean {
  const key = (s: ClassSeries) =>
    JSON.stringify([
      s.course_id ?? null,
      s.title.trim(),
      s.location?.trim() || null,
      [...s.weekdays].sort((x, y) => x - y),
      s.start_time,
      s.end_time,
      s.first_day,
      s.last_day,
      [...s.skip_days].sort(),
    ]);
  return key(a) === key(b);
}

/** What an edit will do, in counts: moved, added, removed, and left alone. */
function Diff({
  plan,
  from,
  when,
  room,
}: {
  plan: NonNullable<ReturnType<typeof planClass>>;
  from: DayKey;
  when: string | null;
  /** The new room when it changed, '' when it was cleared, null when it did not. */
  room: string | null;
}) {
  const renamed = plan.update.length - plan.moved;
  const inRoom = room === null ? '' : room ? `, in ${room}` : ', with no room';
  const nothing = plan.insert.length + plan.update.length + plan.remove.length === 0;
  return (
    <div className="class-diff">
      {nothing && (
        <>
          <b data-quiet>0</b>
          <span className="type-note text-text-mid">sessions change from {formatDay(from)}</span>
        </>
      )}
      {plan.moved > 0 && (
        <>
          <b>{plan.moved}</b>
          <span className="type-note text-text-mid">
            move{when ? ` to ${when}` : ''}
            {inRoom}
          </span>
        </>
      )}
      {renamed > 0 && (
        <>
          <b>{renamed}</b>
          <span className="type-note text-text-mid">{room !== null ? `move to ${room || 'no room'}` : 'take the new name'}</span>
        </>
      )}
      {plan.insert.length > 0 && (
        <>
          <b>{plan.insert.length}</b>
          <span className="type-note text-text-mid">added</span>
        </>
      )}
      {plan.remove.length > 0 && (
        <>
          <b>{plan.remove.length}</b>
          <span className="type-note text-text-mid">removed</span>
        </>
      )}
      <b data-quiet>{plan.before}</b>
      <span className="type-note text-text-low">before {formatDay(from)} stay exactly as they were</span>
    </div>
  );
}

const shortDay = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const label = (d: DayKey) => shortDay.format(new Date(`${d}T12:00:00Z`));

/**
 * The term as a grid: a row per week (labelled by its Monday), a column per
 * day the class meets, a date in each cell. Tapping a cell skips that day or
 * brings it back.
 */
function TermGrid({
  pattern,
  days,
  course,
  before,
  pastLabel,
  changes,
  onToggle,
}: {
  pattern: ClassPattern;
  days: DayKey[];
  course: Course | undefined;
  /** Days before this are drawn faint: already past, or before an edit applies. */
  before: DayKey;
  pastLabel: string;
  changes: DayKey[];
  onToggle: (day: DayKey) => void;
}) {
  const columns = [...new Set(pattern.weekdays)].sort((a, b) => a - b);
  const inPattern = new Set(days);
  const skipped = new Set(pattern.skip_days);
  // The first session on or after each clock change carries the dot.
  const marked = new Set(changes.map((c) => days.find((d) => d >= c)).filter((d): d is DayKey => Boolean(d)));

  const weeks: DayKey[] = [];
  if (days.length > 0) {
    const monday = (d: DayKey) => addDays(d, 1 - isoWeekday(d));
    for (let w = monday(days[0]); w <= days[days.length - 1]; w = addDays(w, 7)) weeks.push(w);
  }

  const style = {
    ...tint(course),
    gridTemplateColumns: `2.75rem repeat(${columns.length}, minmax(0, 1fr))`,
  } as CSSProperties;

  return (
    <div className="term-grid" data-block={course ? true : undefined} style={style} role="group" aria-label="Dates. Tap one to skip it.">
      <span aria-hidden />
      {columns.map((c) => (
        <span key={c} className="term-head" aria-hidden>
          {WEEKDAYS[c - 1].label}
        </span>
      ))}
      {weeks.map((w) => (
        <Week
          key={w}
          monday={w}
          columns={columns}
          inPattern={inPattern}
          skipped={skipped}
          marked={marked}
          before={before}
          pastLabel={pastLabel}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function Week({
  monday,
  columns,
  inPattern,
  skipped,
  marked,
  before,
  pastLabel,
  onToggle,
}: {
  monday: DayKey;
  columns: number[];
  inPattern: Set<DayKey>;
  skipped: Set<DayKey>;
  marked: Set<DayKey>;
  before: DayKey;
  pastLabel: string;
  onToggle: (day: DayKey) => void;
}) {
  return (
    <>
      <span className="term-week" aria-hidden>
        {label(monday)}
      </span>
      {columns.map((c) => {
        const day = addDays(monday, c - 1);
        if (!inPattern.has(day)) return <span key={c} className="term-gap" aria-hidden />;
        const off = skipped.has(day);
        const past = day < before;
        return (
          <button
            key={c}
            type="button"
            className="term-cell"
            aria-pressed={off}
            aria-label={`${formatDay(day)}${off ? ', skipped' : ''}${past ? `, ${pastLabel}` : ''}`}
            data-past={past || undefined}
            data-change={marked.has(day) || undefined}
            onClick={() => onToggle(day)}
          >
            {Number(day.slice(8))}
          </button>
        );
      })}
    </>
  );
}
