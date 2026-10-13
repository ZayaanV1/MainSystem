import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { readFile, readSyllabus } from '../lib/assist';
import { EASE } from '../lib/motion';
import {
  addAssignment,
  addChecklistItem,
  createCourse,
  addEvent,
  assignmentDueAt,
  courseVar,
  finishOnboarding,
  type Course,
} from '../lib/planner';
import type { SyllabusItem } from '../../supabase/functions/_shared/syllabus';
import { todayKey, type DayKey } from '../lib/time';
import { keepSyllabusText } from '../lib/coursePage';
import { urgencyFor } from '../lib/urgency';
import { Tickets } from './SignIn';

/**
 * The first run.
 *
 * A new account lands on a Today screen that is correct, blank and useless:
 * every empty state is honest, and not one of them goes anywhere. This does
 * the order with them (courses, then deadlines, then the daily things) and
 * shows each result as it is made, in the app's own pieces, so the last step
 * is their Today before they open it.
 *
 * Three rules shape it.
 *
 * Every step is skippable and says so. The one button at the bottom says what
 * it will do: Continue once a step has something in it, Skip this step until
 * then. A setup flow that traps you is the first impression of an app whose
 * whole promise is low friction.
 *
 * Nothing here is a question the app could answer itself. It does not ask for
 * a timezone (the browser knows) or a name (it is never shown).
 *
 * Nothing is written without being shown first (rule 6): deadlines a syllabus
 * yields come back as tickets to keep or drop, and only the kept ones are
 * added, when the button that says how many is pressed.
 */

const STEPS = ['welcome', 'courses', 'syllabus', 'daily', 'done'] as const;

/**
 * Suggestions, not defaults.
 *
 * Nothing is pre-ticked. A checklist that arrives pre-populated is one you
 * start by deleting from, and rule 2 is that every mandatory field is a chance
 * for the thought to evaporate — a mandatory deletion is worse.
 */
// Things any student might keep daily. These were "Medication" and
// "Creatine" — the first user's own checklist, offered to every stranger.
const COMMON_DAILY = [
  'Review the day’s notes',
  'Check course sites and email',
  'Plan tomorrow',
  'Read for 20 minutes',
  'Tidy the desk',
];

type Found = SyllabusItem & { keep: boolean };

export function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const direction = useRef<1 | -1>(1);
  const stage = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const [courses, setCourses] = useState<Course[]>([]);

  const [found, setFound] = useState<Found[] | null>(null);
  const [syllabusCourse, setSyllabusCourse] = useState<string | null>(null);
  const [added, setAdded] = useState<Found[]>([]);
  const [syllabusProblem, setSyllabusProblem] = useState<string | null>(null);
  const [syllabusText, setSyllabusText] = useState('');

  const [daily, setDaily] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [savedDaily, setSavedDaily] = useState<string[]>([]);

  const id = STEPS[step];

  // Forward slides in from the right, Back from the left (rule 12), and the
  // step's pieces arrive just behind it.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const el = stage.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ opacity: 0, transform: `translateX(${direction.current * 26}px)` }, { opacity: 1, transform: 'none' }], {
      duration: 380,
      easing: EASE.glide,
    });
    Array.from(el.children).forEach((child, i) =>
      (child as HTMLElement).animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
        duration: 380,
        delay: 40 + i * 35,
        easing: EASE.glide,
        fill: 'backwards',
      }),
    );
  }, [step]);

  const go = (to: number) => {
    direction.current = to > step ? 1 : -1;
    setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
  };

  async function finish() {
    setBusy(true);
    await finishOnboarding(userId);
    setBusy(false);
    onDone();
  }

  /**
   * Adds the kept deadlines, the only write on this step. Through the outbox
   * like every other write, so one that cannot reach the server is held and
   * shown by the sync banner rather than lost.
   */
  async function addFound() {
    const keeping = (found ?? []).filter((f) => f.keep);
    setBusy(true);
    setSyllabusProblem(null);
    for (const item of keeping) {
      const isEvent = item.due_date && (item.kind === 'exam' || item.kind === 'presentation');
      if (isEvent) {
        await addEvent(userId, {
          title: item.title,
          kind: item.kind === 'exam' ? 'exam' : 'presentation',
          day: item.due_date as string,
          time: item.due_time,
          course_id: syllabusCourse,
          weight_percent: item.weight_percent,
        });
      } else {
        await addAssignment(userId, {
          title: item.title,
          course_id: syllabusCourse,
          due_at: assignmentDueAt(item.due_date, item.due_time),
          due_has_time: Boolean(item.due_time),
          // Kept, not dropped. This path once lost every weight the reader
          // found, the same bug the main importer had.
          weight_percent: item.weight_percent,
        });
      }
    }
    // The text the deadlines came from, kept on the course's page.
    await keepSyllabusText(userId, syllabusCourse, syllabusText);
    setBusy(false);
    setAdded((a) => [...a, ...keeping]);
    setFound(null);
    go(step + 1);
  }

  async function saveDaily() {
    const fresh = daily.filter((t) => !savedDaily.includes(t));
    setBusy(true);
    for (const [i, title] of fresh.entries()) {
      await addChecklistItem(
        userId,
        {
          title,
          essential: false,
          remind_at: null,
          recurrence: 'daily',
          weekdays: [1, 2, 3, 4, 5],
          interval_days: 7,
          anchor_day: null,
          tracks_doses: false,
          doses_remaining: 0,
          doses_per_completion: 1,
          refill_warning_days: 3,
        },
        savedDaily.length + i + 1,
      );
    }
    setBusy(false);
    setSavedDaily((s) => [...s, ...fresh]);
    go(step + 1);
  }

  // What the one button says and does on each step.
  const kept = (found ?? []).filter((f) => f.keep).length;
  const action: { label: string; quiet: boolean; run: () => void } = (() => {
    switch (id) {
      case 'welcome':
        return { label: 'Start', quiet: false, run: () => go(1) };
      case 'courses':
        return courses.length
          ? { label: 'Continue', quiet: false, run: () => go(2) }
          : { label: 'Skip this step', quiet: true, run: () => go(2) };
      case 'syllabus':
        if (found && kept)
          return { label: busy ? 'Adding' : `Add ${kept} ${kept === 1 ? 'deadline' : 'deadlines'}`, quiet: false, run: () => void addFound() };
        return added.length && !found
          ? { label: 'Continue', quiet: false, run: () => go(3) }
          : { label: 'Skip this step', quiet: true, run: () => go(3) };
      case 'daily':
        return daily.length
          ? { label: busy ? 'Adding' : 'Continue', quiet: false, run: () => void saveDaily() }
          : { label: 'Skip this step', quiet: true, run: () => go(4) };
      default:
        return { label: busy ? 'One moment' : 'Open my planner', quiet: false, run: () => void finish() };
    }
  })();

  return (
    <main className="firstrun">
      <div className="firstrun-top">
        <div className="firstrun-progress" aria-hidden>
          {STEPS.map((s, i) => (
            <i key={s} data-on={i <= step || undefined} />
          ))}
        </div>
        <span className="sr-only">
          Step {step + 1} of {STEPS.length}
        </span>
        {id !== 'done' && (
          <button type="button" className="firstrun-skip" onClick={() => go(STEPS.length - 1)}>
            Skip setup
          </button>
        )}
      </div>

      <div ref={stage} key={id} className="firstrun-stage" aria-live="polite">
        {id === 'welcome' && <Welcome />}
        {id === 'courses' && <Courses userId={userId} courses={courses} onAdded={(c) => setCourses((l) => [...l, c])} />}
        {id === 'syllabus' && (
          <Syllabus
            courses={courses}
            courseId={syllabusCourse}
            onCourse={setSyllabusCourse}
            found={found}
            onFound={setFound}
            added={added.length}
            problem={syllabusProblem}
            onProblem={setSyllabusProblem}
            onText={setSyllabusText}
          />
        )}
        {id === 'daily' && (
          <Daily
            choices={[...COMMON_DAILY, ...extra]}
            selected={daily}
            saved={savedDaily}
            onToggle={(t) => setDaily((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]))}
            onAdd={(t) => {
              if (![...COMMON_DAILY, ...extra].includes(t)) setExtra((e) => [...e, t]);
              setDaily((d) => (d.includes(t) ? d : [...d, t]));
            }}
          />
        )}
        {id === 'done' && <Done courses={courses} deadlines={added} daily={savedDaily} courseId={syllabusCourse} />}
      </div>

      <div className="firstrun-bar">
        {step > 0 && (
          <Button variant="quiet" disabled={busy} onClick={() => go(step - 1)} className="firstrun-back">
            Back
          </Button>
        )}
        <Button
          variant={action.quiet ? 'quiet' : 'primary'}
          disabled={busy}
          onClick={action.run}
          className="firstrun-next"
          data-quiet={action.quiet || undefined}
        >
          {action.label}
        </Button>
      </div>
    </main>
  );
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 className="firstrun-h1">{title}</h1>
      <p className="firstrun-p">{children}</p>
    </>
  );
}

function Welcome() {
  return (
    <>
      <Heading title="Let’s get your term in.">
        Three short steps, each one skippable. What you enter shows up as you go, the way Today will show it.
      </Heading>
      <div className="firstrun-art">
        <Tickets />
      </div>
      <ol className="firstrun-steps">
        <li>
          <span className="n">1</span>
          <span>
            <b>Your courses</b>
            <span>So your work takes their colours</span>
          </span>
        </li>
        <li>
          <span className="n">2</span>
          <span>
            <b>A syllabus</b>
            <span>Every deadline in it, checked by you before anything is added</span>
          </span>
        </li>
        <li>
          <span className="n">3</span>
          <span>
            <b>Daily things</b>
            <span>Ticked off on Today, never counted against you</span>
          </span>
        </li>
      </ol>
    </>
  );
}

function Courses({ userId, courses, onAdded }: { userId: string; courses: Course[]; onAdded: (c: Course) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setProblem('Give the course a name. The code is optional.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const created = await createCourse(userId, name, (courses.length % 8) + 1, code);
    setBusy(false);

    // A failure used to clear the fields and show nothing, so the course
    // simply did not appear. Keep what was typed and say why.
    if (!created) {
      setProblem('Couldn’t add that course. It may already be on your list, or the connection dropped. Try again.');
      return;
    }
    onAdded(created);
    setName('');
    setCode('');
  }

  return (
    <>
      <Heading title="What are you taking?">
        Courses colour your work and let a syllabus match itself up. The code is optional.
      </Heading>
      <div className="firstrun-courses" aria-live="polite">
        {courses.length ? (
          courses.map((c) => (
            <Chip key={c.id} courseVar={courseVar(c.colour_index)} className="enter-fade">
              {c.code ? (
                <>
                  {c.code} <span className="text-text-low">{c.name}</span>
                </>
              ) : (
                c.name
              )}
            </Chip>
          ))
        ) : (
          <span className="type-note text-text-low">Nothing yet. Add one below.</span>
        )}
      </div>
      <form onSubmit={add} className="firstrun-add" noValidate>
        <Field label="Course" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Organization" autoComplete="off" />
        <Field label="Code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="COEN 311" autoComplete="off" />
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? 'Adding' : 'Add'}
        </Button>
      </form>
      {problem && (
        <p className="type-note text-t-overdue" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

/**
 * The step that does the most work.
 *
 * One syllabus takes an account from empty to a full term, which no other
 * single action here comes close to. Text, a PDF or a photo, through the same
 * reader Plan uses; what it finds comes back as tickets to keep or drop.
 */
function Syllabus({
  courses,
  courseId,
  onCourse,
  found,
  onFound,
  added,
  problem,
  onProblem,
  onText,
}: {
  courses: Course[];
  courseId: string | null;
  onCourse: (id: string | null) => void;
  found: Found[] | null;
  onFound: (f: Found[] | null) => void;
  added: number;
  problem: string | null;
  onProblem: (p: string | null) => void;
  /** The text read, kept for the course's page; empty for a PDF or photo. */
  onText: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  async function run(input: { text?: string; pdf?: { data: string; mimeType: string } }) {
    setReading(true);
    onProblem(null);
    const result = await readSyllabus(input);
    setReading(false);
    if (!result.ok) {
      onProblem(result.reason);
      return;
    }
    if (result.items.length === 0) {
      onProblem('No deadlines in that. The evaluation or schedule section is the part to use.');
      return;
    }
    onText(input.text ?? '');
    onFound(result.items.map((i) => ({ ...i, keep: true })));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    const data = await readFile(file);
    setReading(false);
    if (!data) {
      onProblem('Couldn’t read that file. Paste the text instead.');
      return;
    }
    await run({ pdf: data });
  }

  return (
    <>
      <Heading title="Bring in a syllabus.">
        The evaluation section is enough. Every deadline it finds comes back here to keep or drop; nothing is added until you say how many.
      </Heading>

      {courses.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Whose syllabus">
          {courses.map((c) => (
            <Chip key={c.id} courseVar={courseVar(c.colour_index)} selected={courseId === c.id} onClick={() => onCourse(courseId === c.id ? null : c.id)}>
              {c.code ?? c.name}
            </Chip>
          ))}
        </div>
      )}

      {found ? (
        <div className="firstrun-found">
          {found.map((f, i) => (
            <FoundTicket
              key={`${f.title}-${i}`}
              item={f}
              course={courses.find((c) => c.id === courseId) ?? null}
              onToggle={() => onFound(found.map((x, n) => (n === i ? { ...x, keep: !x.keep } : x)))}
            />
          ))}
          <button type="button" className="link-button" onClick={() => onFound(null)}>
            Read a different one
          </button>
        </div>
      ) : (
        <>
          {added > 0 && <p className="type-note text-t-done">{added} added. Read another, or carry on.</p>}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            aria-label="Syllabus text"
            placeholder={'Assignment 1 .... 5%   Due September 25\nMidterm ......... 25%  October 22'}
            className="well firstrun-syllabus type-body text-text-hi placeholder:text-text-low"
          />
          <div className="firstrun-or">
            <input ref={pdfInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Chip onClick={() => pdfInput.current?.click()} disabled={reading}>
              Choose a PDF
            </Chip>
            <Chip onClick={() => photoInput.current?.click()} disabled={reading}>
              Take a photo
            </Chip>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              disabled={reading}
              onClick={() => {
                if (text.trim().length < 20) {
                  onProblem('Paste a little more: the part with the deadlines and their dates.');
                  return;
                }
                void run({ text: text.trim() });
              }}
            >
              {reading ? 'Reading' : 'Read it'}
            </Button>
          </div>
        </>
      )}
      {problem && (
        <p className="type-note text-t-overdue" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

/** A deadline the reader found, as the ticket it will become, with Keep or Dropped. */
function FoundTicket({ item, course, onToggle }: { item: Found; course: Course | null; onToggle?: () => void }) {
  const stub = stubFor(item);
  const meta = [course?.code ?? course?.name, kindWord(item.kind), item.weight_percent ? `${item.weight_percent}%` : null].filter(Boolean).join(' · ');
  return (
    <div
      className="mat firstrun-ticket"
      data-block={course ? true : undefined}
      data-dropped={!item.keep || undefined}
      style={course ? ({ '--b': `var(${courseVar(course.colour_index)}-rgb)` } as CSSProperties) : undefined}
    >
      <span className="signin-stub" style={{ color: `var(${stub.tone})` }}>
        <b>{stub.n}</b>
        <i>{stub.u}</i>
      </span>
      <span className="signin-tk-body">
        <b>{item.title}</b>
        <i>{meta || 'No course'}</i>
      </span>
      {onToggle ? (
        <button type="button" className="firstrun-keep" aria-pressed={item.keep} onClick={onToggle}>
          {item.keep ? 'Keep' : 'Dropped'}
        </button>
      ) : (
        <span className="signin-ring" />
      )}
    </div>
  );
}

function kindWord(kind: SyllabusItem['kind']): string | null {
  return kind === 'exam' ? 'exam' : kind === 'presentation' ? 'presentation' : null;
}

/** The stub: the date it is due, in the urgency colour it will carry on Today. */
function stubFor(item: SyllabusItem): { n: string; u: string; tone: string } {
  if (!item.due_date) return { n: '–', u: 'no date', tone: '--text-low' };
  const due = assignmentDueAt(item.due_date, item.due_time);
  const urgency = urgencyFor(due ? new Date(due) : null);
  const d = new Date(`${item.due_date}T12:00:00Z`);
  return {
    n: String(d.getUTCDate()),
    u: new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short' }).format(d),
    tone: urgency.colourVar,
  };
}

function Daily({
  choices,
  selected,
  saved,
  onToggle,
  onAdd,
}: {
  choices: string[];
  selected: string[];
  saved: string[];
  onToggle: (t: string) => void;
  onAdd: (t: string) => void;
}) {
  const [custom, setCustom] = useState('');
  return (
    <>
      <Heading title="Anything you do every day?">
        These show up on Today to tick off. Nothing is pre-selected; pick what is actually yours.
      </Heading>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Daily things">
        {choices.map((c) => {
          const isSaved = saved.includes(c);
          return (
            <Chip key={c} selected={selected.includes(c)} disabled={isSaved} onClick={() => onToggle(c)} title={isSaved ? 'Added. Edit it from Today.' : undefined}>
              {c}
            </Chip>
          );
        })}
      </div>
      <form
        className="firstrun-add"
        data-one
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!custom.trim()) return;
          onAdd(custom.trim());
          setCustom('');
        }}
      >
        <Field label="Something else" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Water the plant" autoComplete="off" />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>
      <div className="firstrun-preview">
        <span className="kicker">On Today</span>
        {selected.length ? (
          <div className="tick-pills">
            {selected.map((t) => (
              <span key={t} className="tick-pill enter-fade">
                <span className="tick" />
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span className="type-note text-text-low">Your choices appear here, as Today shows them.</span>
        )}
      </div>
    </>
  );
}

/**
 * The end: their Today, assembled from what they entered, before they open
 * it. It states what is there rather than congratulating anyone for
 * arriving; praise for completing a setup form is praise for nothing.
 */
function Done({ courses, deadlines, daily, courseId }: { courses: Course[]; deadlines: Found[]; daily: string[]; courseId: string | null }) {
  const any = courses.length || deadlines.length || daily.length;
  const today = todayKey();
  const course = courses.find((c) => c.id === courseId) ?? null;
  const soonest = [...deadlines].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 3);
  return (
    <>
      <Heading title={any ? 'That’s your term.' : 'That’s it.'}>
        {any
          ? 'Here is Today with what you entered. Capture anything at the top and sort it later; it needs no date, course or category to be worth writing down.'
          : 'Today shows what is due and what is left. Courses, syllabi and daily things can all be added later from Courses.'}
      </Heading>
      <div className="mat mat-raised firstrun-today" aria-label="A preview of Today">
        <div className="flex items-baseline justify-between gap-3">
          <span className="type-masthead firstrun-today-day">{weekday(today)}</span>
          <span className="today-date">{monthDay(today)}</span>
        </div>
        <span className="well firstrun-today-capture">Capture anything</span>
        {daily.length > 0 && (
          <div className="tick-pills">
            {daily.map((t) => (
              <span key={t} className="tick-pill">
                <span className="tick" />
                {t}
              </span>
            ))}
          </div>
        )}
        {soonest.length > 0 ? (
          soonest.map((d, i) => <FoundTicket key={`${d.title}-${i}`} item={d} course={course} />)
        ) : courses.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {courses.map((c) => (
              <Chip key={c.id} courseVar={courseVar(c.colour_index)}>
                {c.code ?? c.name}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="type-note text-text-low">Nothing due.</p>
        )}
        {deadlines.length > soonest.length && (
          <p className="type-note text-text-low">and {deadlines.length - soonest.length} more, further out</p>
        )}
      </div>
    </>
  );
}

function weekday(day: DayKey): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${day}T12:00:00Z`));
}

function monthDay(day: DayKey): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
}
