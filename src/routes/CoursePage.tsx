import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { SectionHead } from '../components/SectionHead';
import { SheetPresence } from '../components/Sheet';
import { ExamPrep } from './ExamPrep';
import {
  EMPTY_PAGE,
  forgetCourseFact,
  loadCourse,
  normaliseUrl,
  saveCoursePage,
  type CourseEvent,
  type CourseFact,
  type CourseLink,
  type CoursePage as Page,
} from '../lib/coursePage';
import { courseGrades, gradeSummary, neededOnRest, neededSentence, withWhatIf } from '../lib/grades';
import { courseVar, type Assignment, type Course } from '../lib/planner';
import { moduleOn, usePreferences } from '../lib/preferences';
import { formatDay, formatTime, localDayKey, todayKey } from '../lib/time';
import { urgencyFor } from '../lib/urgency';

/**
 * A course, on one page.
 *
 * Assembled from what the app already knows (what is coming up, what the
 * course is made of and what is marked), with a few things only the person
 * can write beside it: office hours, contacts, links, notes, and the syllabus
 * as it was read. Never a blank page to fill before it helps: a course with
 * nothing written still shows its dates and its grade breakdown.
 *
 * Not notes in general, which are out of scope. Abood files facts about a
 * course here ("labs are in H-821") so they are visible and removable rather
 * than kept somewhere unseen.
 */
export function CoursePage({
  course,
  userId,
  onBack,
  onOpenWork,
  onChanged,
}: {
  course: Course;
  userId: string;
  onBack: () => void;
  onOpenWork?: (id: string) => void;
  /** Something was added here that Today should show. */
  onChanged?: () => void;
}) {
  const prefs = usePreferences();
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadCourse>> | null>(null);
  const [page, setPage] = useState<Page>(EMPTY_PAGE);
  const [facts, setFacts] = useState<CourseFact[]>([]);
  const [prepFor, setPrepFor] = useState<CourseEvent | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    void loadCourse(course.id).then((r) => {
      if (!live) return;
      setLoaded(r);
      setPage(r.page);
      setFacts(r.facts);
    });
    return () => {
      live = false;
    };
  }, [course.id, revision]);

  const cv = courseVar(course.colour_index);
  const tint = cv ? ({ '--b': `var(${cv}-rgb)` } as CSSProperties) : undefined;

  return (
    <main className="page-frame course-page">
      <button type="button" className="settings-back" onClick={onBack}>
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 6-6 6 6 6" />
        </svg>
        Courses
      </button>

      <header className="course-head mat" data-block={cv ? true : undefined} style={tint}>
        <span aria-hidden className="chip-dot" />
        <h1 className="page-title">{course.code ?? course.name}</h1>
        {course.code && course.name !== course.code && <p className="type-body text-text-mid">{course.name}</p>}
      </header>

      {loaded === null ? (
        <p className="px-4 type-note text-text-low">Loading the course.</p>
      ) : (
        <>
          {loaded.failed && (
            <p role="alert" className="mb-6 px-4 type-note text-t-overdue">
              Part of this course didn’t load. Nothing is lost; reopen the page to try again.
            </p>
          )}

          <ComingUp work={loaded.work} events={loaded.events} onOpenWork={onOpenWork} onPrep={setPrepFor} />

          <SheetPresence>
            {prepFor && (
              <ExamPrep
                exam={prepFor}
                course={course}
                userId={userId}
                onClose={() => setPrepFor(null)}
                onAdded={() => {
                  setRevision((n) => n + 1);
                  onChanged?.();
                }}
              />
            )}
          </SheetPresence>

          {moduleOn('grades', prefs) && <Standing work={loaded.work} events={loaded.events} />}

          <section className="mb-8">
            <SectionHead title="People and hours" />
            <div className="flex flex-col gap-4 px-4">
              <SavedText
                label="Office hours"
                placeholder="Tue 2–4 p.m., EV 3.301"
                value={page.office_hours}
                rows={2}
                onSave={(office_hours) => saveCoursePage(userId, course.id, { office_hours })}
                onSaved={(office_hours) => setPage((p) => ({ ...p, office_hours }))}
              />
              <SavedText
                label="Contacts"
                placeholder="Prof. Okafor, okafor@school.edu · TA Priya, labs"
                value={page.contacts}
                rows={2}
                onSave={(contacts) => saveCoursePage(userId, course.id, { contacts })}
                onSaved={(contacts) => setPage((p) => ({ ...p, contacts }))}
              />
            </div>
          </section>

          <Links
            links={page.links}
            onChange={async (links) => {
              const before = page.links;
              setPage((p) => ({ ...p, links }));
              const r = await saveCoursePage(userId, course.id, { links });
              if (r.error) setPage((p) => ({ ...p, links: before }));
              return r;
            }}
          />

          <section className="mb-8">
            <SectionHead title="Notes" />
            <div className="px-4">
              <SavedText
                label="Notes"
                hideLabel
                placeholder="Anything worth keeping about this course"
                value={page.notes}
                rows={5}
                onSave={(notes) => saveCoursePage(userId, course.id, { notes })}
                onSaved={(notes) => setPage((p) => ({ ...p, notes }))}
              />
            </div>
          </section>

          {moduleOn('abood', prefs) && (
            <section className="mb-8">
              <SectionHead title="What Abood knows" count={facts.length || null} />
              {facts.length === 0 ? (
                <p className="px-4 type-note text-text-low">
                  Tell Abood something about {course.code ?? course.name}, like where the labs are, and it is filed here.
                </p>
              ) : (
                <div className="mat flex flex-col">
                  {facts.map((f) => (
                    <div key={f.id} className="mat-row flex items-center gap-3 px-4 py-2.5">
                      <span className="type-quote min-w-0 flex-1 text-text-hi">{f.fact}</span>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => {
                          setFacts((list) => list.filter((x) => x.id !== f.id));
                          void forgetCourseFact(f.id).then((r) => {
                            if (r.error) setFacts((list) => [...list, f]);
                          });
                        }}
                      >
                        Forget
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {page.syllabus_text && (
            <section className="mb-12">
              <details className="mat course-syllabus">
                <summary>
                  <span className="kicker">The syllabus, as it was read</span>
                </summary>
                <p className="type-quote whitespace-pre-wrap text-text-mid">{page.syllabus_text}</p>
              </details>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/** What is next for the course: open work and the events still ahead, by date. */
function ComingUp({
  work,
  events,
  onOpenWork,
  onPrep,
}: {
  work: Assignment[];
  events: CourseEvent[];
  onOpenWork?: (id: string) => void;
  onPrep?: (exam: CourseEvent) => void;
}) {
  const today = todayKey();
  const items = useMemo(() => {
    const open = work
      .filter((a) => a.status !== 'done' && a.due_at)
      .map((a) => ({ kind: 'work' as const, id: a.id, title: a.title, at: a.due_at as string, timed: a.due_has_time, a }));
    const ahead = events
      .filter((e) => localDayKey(new Date(e.starts_at)) >= today)
      .map((e) => ({ kind: 'event' as const, id: e.id, title: e.title, at: e.starts_at, timed: !e.all_day, e }));
    return [...open, ...ahead].sort((x, y) => x.at.localeCompare(y.at)).slice(0, 6);
  }, [work, events, today]);
  const undated = work.filter((a) => a.status !== 'done' && !a.due_at).length;

  return (
    <section className="mb-8">
      <SectionHead title="Coming up" />
      {items.length === 0 ? (
        <p className="px-4 type-note text-text-low">
          Nothing dated for this course{undated ? `, and ${undated} without a date` : ''}.
        </p>
      ) : (
        <div className="mat flex flex-col">
          {items.map((i) => {
            const when = new Date(i.at);
            const day = formatDay(localDayKey(when));
            const label = i.kind === 'work' ? urgencyFor(when).label : i.e.kind === 'exam' ? 'Exam' : i.e.kind === 'presentation' ? 'Presentation' : i.e.kind === 'lab' ? 'Lab' : i.e.kind === 'class' ? 'Class' : 'Event';
            const tone = i.kind === 'work' ? urgencyFor(when).colourVar : '--text-mid';
            const body = (
              <>
                <span className="course-when">
                  <b>{day}</b>
                  {i.timed && <span>{formatTime(when)}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-label text-text-hi">{i.title}</span>
                  <span className="type-caption" style={{ color: `var(${tone})` }}>
                    {label}
                  </span>
                </span>
              </>
            );
            if (i.kind === 'work' && onOpenWork)
              return (
                <button key={i.id} type="button" className="mat-row course-row" onClick={() => onOpenWork(i.id)}>
                  {body}
                </button>
              );
            // An exam or presentation still ahead can be planned for.
            const preppable = i.kind === 'event' && onPrep && (i.e.kind === 'exam' || i.e.kind === 'presentation') && localDayKey(when) > today;
            return (
              <div key={i.id} className="mat-row course-row">
                {body}
                {preppable && (
                  <Button variant="secondary" size="sm" onClick={() => onPrep(i.e)}>
                    Plan prep
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {items.length > 0 && undated > 0 && (
        <p className="mt-2 px-4 type-note text-text-low">
          and {undated} without a date
        </p>
      )}
    </section>
  );
}

/**
 * What the course is made of, what is marked, and two questions answered on
 * request: what the rest would need to average for a target, and what the
 * standing would be with some marks filled in. Neither is saved or shown
 * unless asked.
 */
function Standing({ work, events }: { work: Assignment[]; events: CourseEvent[] }) {
  const items = useMemo(
    () =>
      [
        ...work.map((a) => ({ id: a.id, title: a.title, weight_percent: a.weight_percent, grade_percent: a.grade_percent })),
        ...events.map((e) => ({ id: e.id, title: e.title, weight_percent: e.weight_percent, grade_percent: e.grade_percent })),
      ].filter((i) => typeof i.weight_percent === 'number' && i.weight_percent > 0),
    [work, events],
  );
  const grades = useMemo(() => courseGrades(items), [items]);
  const [target, setTarget] = useState('');
  const [trying, setTrying] = useState(false);
  const [marks, setMarks] = useState<Record<string, number>>({});

  if (grades.empty) {
    return (
      <section className="mb-8">
        <SectionHead title="Grade" />
        <p className="px-4 type-note text-text-low">Nothing here carries a weight yet. A syllabus read for this course fills it in.</p>
      </section>
    );
  }

  const t = Number(target);
  const asked = target.trim() !== '' && Number.isFinite(t) && t > 0 && t <= 100;
  const unmarked = items.filter((i) => i.grade_percent === null);
  const whatIf = Object.keys(marks).length ? withWhatIf(items, marks) : null;

  return (
    <section className="mb-8">
      <SectionHead title="Grade" />
      <div className="mat flex flex-col gap-3 px-4 py-3.5">
        <span aria-hidden className="grade-bar">
          <span className="grade-marked" style={{ width: `${Math.min(100, grades.weightMarked)}%` }} />
          <span
            className="grade-known"
            style={{ width: `${Math.max(0, Math.min(100, grades.weightKnown) - Math.min(100, grades.weightMarked))}%` }}
          />
        </span>
        <span className="type-note text-text-mid">{gradeSummary(grades)}</span>

        <div className="flex flex-col">
          {items.map((i) => (
            <div key={i.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate type-label text-text-hi">{i.title}</span>
              <span className="shrink-0 type-note tabular-nums text-text-low">
                {i.weight_percent}%{i.grade_percent !== null ? ` · scored ${i.grade_percent}` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="course-ask">
          <Field
            label="Target"
            hint="Out of 100. What the rest would need to average to finish there."
            type="number"
            inputMode="decimal"
            min={1}
            max={100}
            placeholder="80"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          {asked && <p className="type-note text-text-mid" aria-live="polite">{neededSentence(neededOnRest(grades, t), t)}</p>}
        </div>

        {unmarked.length > 0 && (
          <div className="flex flex-col gap-2">
            <button type="button" className="link-button" aria-expanded={trying} onClick={() => setTrying((v) => !v)}>
              {trying ? 'Done trying marks' : 'Try some marks'}
            </button>
            {trying && (
              <div className="flex flex-col gap-2 enter-fade">
                <p className="type-note text-text-low">Nothing here is saved. Type a mark to see where the course would stand.</p>
                {unmarked.map((i) => (
                  <label key={i.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate type-label text-text-hi">
                      {i.title} <span className="text-text-low">· {i.weight_percent}%</span>
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      aria-label={`A mark to try for ${i.title}`}
                      className="well w-20 type-body tabular-nums"
                      value={marks[i.id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        const n = Number(v);
                        setMarks((m) => {
                          const next = { ...m };
                          if (v === '' || !Number.isFinite(n)) delete next[i.id];
                          else next[i.id] = Math.max(0, Math.min(100, n));
                          return next;
                        });
                      }}
                    />
                  </label>
                ))}
                {whatIf && <p className="type-note text-text-mid">With those: {gradeSummary(whatIf)}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** A text box that saves when you leave it, and says that it did. */
function SavedText({
  label,
  hideLabel = false,
  placeholder,
  value,
  rows,
  onSave,
  onSaved,
}: {
  label: string;
  hideLabel?: boolean;
  placeholder: string;
  value: string;
  rows: number;
  onSave: (v: string) => Promise<{ error: string | null }>;
  onSaved: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  useEffect(() => setDraft(value), [value]);

  // Leaving without a blur (Back from the keyboard, the app sent to the
  // background, the tab closed) still saves: what was typed is never left
  // only in a text box that is about to disappear. `sent` is the last text
  // handed to the server, so nothing is sent twice.
  const sent = useRef(value);
  useEffect(() => {
    sent.current = value;
  }, [value]);
  const latest = useRef({ draft, onSave });
  latest.current = { draft, onSave };
  useEffect(() => {
    const flush = () => {
      const { draft: d, onSave: save } = latest.current;
      if (d === sent.current) return;
      sent.current = d;
      void save(d);
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  async function save() {
    if (draft === sent.current) return;
    const before = sent.current;
    sent.current = draft;
    setStatus('saving');
    const r = await onSave(draft);
    if (r.error) {
      sent.current = before;
      setStatus(r.error);
      return;
    }
    onSaved(draft);
    setStatus('saved');
  }

  return (
    <label className="flex flex-col gap-2">
      <span className={hideLabel ? 'sr-only' : 'kicker'}>{label}</span>
      <textarea
        className="well course-text type-body text-text-hi placeholder:text-text-low"
        rows={rows}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (status !== 'idle' && status !== 'saving') setStatus('idle');
        }}
        onBlur={() => void save()}
      />
      <span className={`type-note ${status !== 'idle' && status !== 'saving' && status !== 'saved' ? 'text-t-overdue' : 'text-text-low'}`} aria-live="polite">
        {status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'idle' ? '' : status}
      </span>
    </label>
  );
}

function Links({ links, onChange }: { links: CourseLink[]; onChange: (links: CourseLink[]) => Promise<{ error: string | null }> }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const clean = normaliseUrl(url);
    if (!clean) {
      setProblem('That doesn’t look like a web address. It should start with http:// or https://, or be a site like moodle.school.edu.');
      return;
    }
    setProblem(null);
    const name = label.trim() || new URL(clean).hostname.replace(/^www\./, '');
    const r = await onChange([...links, { label: name, url: clean }]);
    if (r.error) {
      setProblem(r.error);
      return;
    }
    setLabel('');
    setUrl('');
  }

  return (
    <section className="mb-8">
      <SectionHead title="Links" count={links.length || null} />
      {links.length > 0 && (
        <div className="mat mb-4 flex flex-col">
          {links.map((l, i) => (
            <div key={`${l.url}-${i}`} className="mat-row flex items-center gap-3 px-4 py-2">
              <a className="min-w-0 flex-1 course-link" href={l.url} target="_blank" rel="noopener noreferrer">
                <span className="block truncate type-label text-text-hi">{l.label}</span>
                <span className="block truncate type-note text-text-low">{l.url.replace(/^https?:\/\//, '')}</span>
              </a>
              <Button variant="quiet" size="sm" aria-label={`Remove ${l.label}`} onClick={() => void onChange(links.filter((_, n) => n !== i))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="course-link-add px-4" noValidate>
        <Field label="Name" placeholder="Moodle" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
        <Field
          label="Address"
          inputMode="url"
          placeholder="moodle.school.edu/course/364"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          error={problem}
        />
        <Button type="submit" variant="secondary">
          Add link
        </Button>
      </form>
    </section>
  );
}
