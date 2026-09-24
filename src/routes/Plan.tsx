import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { SectionHead } from '../components/SectionHead';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { RepeatingWork } from './RepeatingWork';
import { SeriesList } from './SeriesList';
import { CalendarImport } from './CalendarImport';
import { CalendarFeeds } from './CalendarFeeds';
import { courseGrades, gradeSummary } from '../lib/grades';
import { SyllabusImport } from './SyllabusImport';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { useAuth } from '../lib/auth';
import { dueTimestamp, looksFarOff, parseBulk, summarise, type ParsedRow } from '../lib/bulk';
import { enqueue } from '../lib/outbox';
import {
  addCourse,
  courseVar,
  loadAllCourses,
  loadWeightedWork,
  setCourseArchived,
  type Assignment,
  type Course,
} from '../lib/planner';
import { formatDay } from '../lib/time';

/**
 * Plan — where a semester gets loaded in one go.
 *
 * Pulled forward from its natural position because term starts in weeks and
 * manual entry of a semester's deadlines never gets done. An incomplete
 * calendar is an untrusted calendar, and an untrusted calendar stops being
 * opened.
 *
 * The preview is not optional and not a convenience. Rule 6: nothing parsed is
 * written until it has been shown. A row the parser guessed at is marked as
 * guessed, and a row it could not read is excluded rather than approximated.
 */
export function Plan({ courses, onBack, onChanged }: {
  courses: Course[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedRow[] | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [seriesKey, setSeriesKey] = useState(0);
  const [importingCalendar, setImportingCalendar] = useState(false);

  const courseRefs = useMemo(
    () => courses.map((c) => ({ id: c.id, name: c.name, code: c.code })),
    [courses],
  );

  function runParse() {
    const rows = parseBulk(text, courseRefs);
    setPreview(rows);
    // Unusable rows start excluded, so the default action can never write a
    // row the parser did not understand.
    setSkipped(new Set(rows.map((r, i) => (r.usable ? -1 : i)).filter((i) => i >= 0)));
    setResult(null);
  }

  const chosen = (preview ?? []).filter((r, i) => r.usable && !skipped.has(i));

  async function commit() {
    setSaving(true);
    try {
      for (const row of chosen) {
        if (row.kind === 'event' && row.dueDay) {
          await enqueue('events', 'insert', {
            user_id: userId,
            course_id: row.courseId,
            title: row.title,
            kind: row.eventKind,
            starts_at: dueTimestamp(row),
            all_day: !row.dueTime,
          });
        } else {
          await enqueue('assignments', 'insert', {
            user_id: userId,
            course_id: row.courseId,
            title: row.title,
            due_at: dueTimestamp(row),
            due_has_time: Boolean(row.dueTime),
            effort_minutes: row.effortMinutes,
          });
        }
      }

      setResult(`Added ${chosen.length}.`);
      setText('');
      setPreview(null);
      setSkipped(new Set());
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="page-title">Courses and syllabus</h1>
        <Button variant="quiet" onClick={onBack}>
          Today
        </Button>
      </header>

      <CourseEditor userId={userId} courses={courses} onChanged={onChanged} />

      {/*
        Above the importer on purpose. Once a syllabus has been read this is
        the answer it produced, and it is the reason to read another one.
      */}
      <Grades courses={courses} />

      {/*
        Above the syllabus importer, because it is the cheaper of the two ways
        in. A weekly lab does not need a document — it needs one sentence and a
        weekday, and making someone paste a syllabus to express "every Tuesday"
        is friction where there need be none.
      */}
      <section className="mb-8">
        <SectionHead title="Something every week" />
        <p className="type-note -mt-2 mb-3 px-4 text-text-low">
          A weekly lab, a Tuesday tutorial, a biweekly problem set. Set the
          pattern once and every one gets its own date.
        </p>
        <div className="px-4">
          <Button variant="secondary" onClick={() => setRepeating(true)}>
            Add repeating work
          </Button>
        </div>

        {/*
          The patterns that already exist. Creating one writes up to two
          hundred rows, and until this list existed there was no way to see,
          end or extend a pattern afterwards — the series table was written to
          and never read.
        */}
        <SeriesList
          userId={userId}
          courses={courses}
          refreshKey={seriesKey}
          onChanged={onChanged}
        />
      </section>

      {/*
        Above the one-time importer, because it is now the main way a calendar
        gets in. The importer stays for what it is good at: a fixed term
        timetable you want as ordinary events you own and can edit. This is
        for a calendar that keeps changing and has to stay right on its own.
      */}
      <CalendarFeeds onChanged={onChanged} />

      <section className="mb-8">
        <SectionHead title="Bring in your timetable" />
        <p className="type-note -mt-2 mb-3 px-4 text-text-low">
          Paste your university&rsquo;s calendar file and every lecture, tutorial
          and lab lands on the right day. A weekly class becomes one entry here
          and a term of events in the app.
        </p>
        <div className="px-4">
          <Button variant="secondary" onClick={() => setImportingCalendar(true)}>
            Import a timetable
          </Button>
        </div>
      </section>

      <section className="mb-8">
        <SectionHead title="Read a whole syllabus" />
        <p className="type-note -mt-2 mb-3 px-4 text-text-low">
          Paste the whole thing or hand it a PDF. Every deliverable comes back for checking before
          anything is added.
        </p>
        <div className="px-4">
          <Button variant="primary" onClick={() => setImporting(true)}>
            Import a syllabus
          </Button>
        </div>
      </section>

      <section className="mb-8">
        <SectionHead title="Type deadlines" />
        <p className="type-note -mt-2 mb-3 px-4 text-text-low">
          One per line. Course, date, time and effort are picked out wherever they sit. No model
          involved, so this works offline and never runs out of requests.
        </p>

        <div className="px-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={'CHEM 233: Lab report, Sept 12, 3h\nEssay draft — Sep 20 at 11:59pm\nMidterm exam, Oct 15'}
            className="well p-4 type-body text-text-hi placeholder:text-text-low"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={runParse} disabled={!text.trim()}>
              Check what this adds
            </Button>
            {result && <span className="type-caption text-text-mid">{result}</span>}
          </div>
        </div>
      </section>

      {preview && (
        <section className="mb-12">
          <SectionHead title="Before anything is saved" />
          <p className="type-caption mb-3 px-4 text-text-low">{summarise(chosen)}</p>

          <Card>
            {preview.map((row, i) => (
              <PreviewRow
                key={i}
                row={row}
                courses={courses}
                excluded={skipped.has(i)}
                onToggle={() =>
                  setSkipped((s) => {
                    const next = new Set(s);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              />
            ))}
          </Card>

          <div className="mt-4 flex flex-wrap gap-3 px-4">
            <Button variant="primary" onClick={() => void commit()} disabled={saving || !chosen.length}>
              {saving ? 'Adding' : `Add ${chosen.length}`}
            </Button>
            <Button variant="quiet" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <SyllabusImport
        open={importing}
        userId={userId}
        courses={courses}
        onClose={() => setImporting(false)}
        onImported={onChanged}
      />
      <RepeatingWork
        open={repeating}
        onClose={() => setRepeating(false)}
        userId={userId}
        courses={courses}
        onCreated={() => {
          setSeriesKey((n) => n + 1);
          onChanged();
        }}
      />

      <CalendarImport
        open={importingCalendar}
        onClose={() => setImportingCalendar(false)}
        userId={userId}
        courses={courses}
        onImported={onChanged}
      />

    </main>
  );
}

function PreviewRow({
  row,
  courses,
  excluded,
  onToggle,
}: {
  row: ParsedRow;
  courses: Course[];
  excluded: boolean;
  onToggle: () => void;
}) {
  const course = courses.find((c) => c.id === row.courseId);

  return (
    <div className="border-b border-ink-600 px-4 py-3 last:border-b-0">
      <Pressable align="start" className="gap-3"
        onClick={onToggle}
        disabled={!row.usable}
        aria-pressed={!excluded}>
        <span
          aria-hidden
          className={[
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
            !row.usable ? 'border-ink-600' : excluded ? 'border-ink-600' : 'border-t-done bg-t-done',
          ].join(' ')}
        >
          {row.usable && !excluded && (
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
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

        <span className="min-w-0 flex-1">
          {row.usable ? (
            <>
              <span className="flex items-center gap-2">
                {course && (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-pill"
                    style={{ backgroundColor: `var(${courseVar(course.colour_index)})` }}
                  />
                )}
                <span className={`type-body ${excluded ? 'text-text-low' : 'text-text-hi'}`}>
                  {row.title}
                </span>
              </span>

              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="type-caption text-text-mid">
                  {row.kind === 'event' ? row.eventKind : 'assignment'}
                </span>
                <span className="type-caption text-text-mid">
                  {row.dueDay ? formatDay(row.dueDay) : 'no date'}
                </span>
                {row.dueTime && <span className="type-caption text-text-mid">{row.dueTime}</span>}
                {row.effortMinutes && (
                  <span className="type-caption text-text-mid">{row.effortMinutes} min</span>
                )}
              </span>
            </>
          ) : (
            <span className="type-body text-text-low">{row.raw}</span>
          )}

          {/* Everything the parser guessed at, stated plainly. A preview you
              cannot trust is worse than typing it all in by hand. */}
          {row.warnings.length > 0 && (
            <span className="mt-1 block type-caption text-t-approaching">
              {row.warnings.join(' · ')}
            </span>
          )}

          {/*
            A date more than a year out, called out separately and more
            loudly than the parser's own guesses.

            `looksFarOff` was written for this and had never been called, so
            the one date error the warnings above cannot catch went through
            silently: a year that was TYPED rather than assumed. "Essay
            3/15/2027" parses perfectly, raises nothing, and lands a deadline
            eighteen months out — and the syllabus importer's term check does
            not cover this path, because a pasted list has no term. It is a
            sentence rather than a label because it is asking for a decision,
            and type-caption is for machine labels only.
          */}
          {row.usable && looksFarOff(row) && (
            <span className="mt-1 block type-note text-t-urgent">
              That is more than a year away. Check the year.
            </span>
          )}
        </span>
      </Pressable>
    </div>
  );
}

/** Courses, added inline. Eight colours, chosen from the fixed palette. */
function CourseEditor({
  userId,
  courses,
  onChanged,
}: {
  userId: string;
  courses: Course[];
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [all, setAll] = useState<Course[]>([]);

  // Loaded only when the archive is opened, and reloaded after each change.
  // The normal course list already excludes archived ones, so this is the
  // only place that needs the full set.
  const refreshAll = () => void loadAllCourses().then(setAll);

  const nextColour = (courses.length % 8) + 1;

  // The database refuses duplicates outright, so the point of checking here
  // is to name which course clashes, rather than surfacing a constraint
  // violation in the sync banner several seconds later.
  const norm = (v: string) => v.trim().toLowerCase();
  const clash = courses.find(
    (c) =>
      (name.trim() && norm(c.name) === norm(name)) ||
      (code.trim() && c.code && norm(c.code) === norm(code)),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || clash) return;

    await addCourse(userId, name, nextColour, code);
    setName('');
    setCode('');
    setOpen(false);
    onChanged();
  }

  return (
    <section className="mb-8">
      <SectionHead
        title="Courses"
        count={courses.length || null}
        aside={
          <div className="flex items-center gap-2">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setManaging((v) => !v);
                if (!managing) refreshAll();
              }}
            >
              {managing ? 'Done' : 'Archive'}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? 'Cancel' : 'Add'}
            </Button>
          </div>
        }
      />

      {/*
        Archiving a course only stops it appearing in chips, filters and
        syllabus matching. Its work is untouched — last term's record is the
        one thing a planner must not quietly discard, and the copy says so
        rather than leaving "archive" to be read as "delete".
      */}
      {managing ? (
        <div className="flex flex-col">
          <p className="mb-3 px-4 type-note text-text-low">
            Archiving hides a course from the lists. Everything you logged against it stays.
          </p>
          <div className="mat flex flex-col">
          {all.map((c) => (
            <div
              key={c.id}
              className="mat-row flex items-center justify-between gap-4 px-4 py-2"
            >
              <span className={`type-body ${c.archived ? 'text-text-low' : 'text-text-hi'}`}>
                {c.code ?? c.name}
                {c.archived && <span className="tag type-caption"> archived</span>}
              </span>
              <Button variant="quiet" size="sm"
                onClick={() =>
                  void setCourseArchived(c.id, !c.archived).then(() => {
                    refreshAll();
                    onChanged();
                  })
                }>
                {c.archived ? 'Restore' : 'Archive'}
              </Button>
            </div>
          ))}
          </div>
        </div>
      ) : courses.length === 0 && !open ? (
        <EmptyState>No courses yet. Adding them lets a pasted syllabus match itself up.</EmptyState>
      ) : (
        /*
          Each course as a tile of its own glass: the code set large, the full
          name under it. They were four small chips, which is how a filter
          looks — and this is not a filter, it is the term.
        */
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {courses.map((c) => {
            const cv = courseVar(c.colour_index);
            return (
              <div
                key={c.id}
                className="mat flex min-h-24 flex-col justify-end gap-1 px-4 py-3.5"
                data-block={cv ? true : undefined}
                style={cv ? ({ '--b': `var(${cv}-rgb)` } as CSSProperties) : undefined}
              >
                <span aria-hidden className="chip-dot mb-auto" />
                <span className="numeral text-text-hi" style={{ fontSize: '1.375rem', letterSpacing: '-0.02em' }}>
                  {c.code ?? c.name}
                </span>
                {c.code && c.name !== c.code && (
                  <span className="type-note line-clamp-2 text-text-mid">{c.name}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4 px-4">
          <Field
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Organic Chemistry"
          />
          <Field
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CHEM 233"
            hint="Optional. A pasted syllabus matches on this."
            error={clash ? (clash.code ?? clash.name) + ' is already on the list.' : null}
          />
          <Button type="submit" variant="primary" disabled={!name.trim() || Boolean(clash)}>
            Add course
          </Button>
        </form>
      )}
    </section>
  );
}

/**
 * What each course is made of.
 *
 * Subtraction only — banked points, weight still to be marked, how many items
 * are outstanding. No projection, no running average, no verdict. The library
 * this calls documents why at length; the short version is that the moment
 * this derives a judgement it becomes a scoreboard, and a scoreboard is a
 * reason to stop opening the app after a bad first assessment.
 *
 * Renders nothing at all when no work carries a weight, which is most courses
 * until a syllabus has been imported. A block reading "0% of 0%" would be
 * worse than silence.
 */
function Grades({ courses }: { courses: Course[] }) {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await loadWeightedWork();
    setRows(r.rows);
    setFailed(r.failed);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Loading and "nothing weighted" are different facts; neither is an error.
  if (rows === null) return null;
  if (failed) {
    return (
      <section className="mb-8">
        <SectionHead title="Grades" />
        <p className="px-4 type-note text-text-mid">
          Couldn&rsquo;t load what your work is worth. Nothing has been lost.
        </p>
      </section>
    );
  }

  const byCourse = courses
    .map((c) => ({ course: c, grades: courseGrades(rows.filter((r) => r.course_id === c.id)) }))
    .filter((x) => !x.grades.empty);

  if (byCourse.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHead title="Grades" />
      <Card>
        {byCourse.map(({ course, grades }) => {
          const cv = courseVar(course.colour_index);
          return (
            <div
              key={course.id}
              className="mat-row flex flex-col gap-2 px-4 py-3.5"
              data-block={cv ? true : undefined}
              style={cv ? ({ '--b': `var(${cv}-rgb)` } as CSSProperties) : undefined}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="chip-dot" />
                  <span className="type-label text-text-hi">{course.code ?? course.name}</span>
                </span>
                <span className="numeral text-text-hi" style={{ fontSize: '1.25rem' }}>
                  {Math.round(grades.weightKnown)}
                  <span className="type-caption text-text-low"> % on the calendar</span>
                </span>
              </span>
              {/*
                The whole course as one bar, out of 100. Solid is weight with a
                mark recorded, hatched is weight on the calendar but not yet
                marked, and the empty track is what no syllabus has named yet.
                It shows how much of the course is DECIDED, never how well it
                is going — the bar is the course's colour whatever the marks.
              */}
              <span aria-hidden className="grade-bar">
                <span className="grade-marked" style={{ width: `${Math.min(100, grades.weightMarked)}%` }} />
                <span
                  className="grade-known"
                  style={{ width: `${Math.max(0, Math.min(100, grades.weightKnown) - Math.min(100, grades.weightMarked))}%` }}
                />
              </span>
              <span className="type-note text-text-mid">{gradeSummary(grades)}</span>
            </div>
          );
        })}
      </Card>
      <p className="mt-2 px-4 type-note text-text-low">
        Points already decided, and what is still outstanding. Nothing here is a
        prediction.
      </p>
    </section>
  );
}
