import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Field } from '../components/Field';
import { readSyllabus } from '../lib/assist';
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

/**
 * The first run.
 *
 * A new account lands on a Today screen that is correct, blank and useless:
 * every empty state is honest, and not one of them goes anywhere. The person
 * has to work out for themselves that the order is courses, then deadlines,
 * then the daily things. This does that with them.
 *
 * Three rules shape it.
 *
 * Every step is skippable and says so, because a setup flow that traps you is
 * the first impression of an app whose entire promise is low friction. Skip is
 * a real button, not a greyed-out link in the corner.
 *
 * Nothing here is a question the app could answer itself. It does not ask for
 * a timezone (the browser knows), a name (it is never shown), or macro targets
 * (the diet screen is honest about having none, and most people will never
 * open it).
 *
 * It ends by putting a real semester in the app, not by congratulating anyone.
 * The syllabus importer is the shortest path from empty to useful that exists
 * here, so it gets a whole step.
 */

type Step = 'welcome' | 'courses' | 'deadlines' | 'daily' | 'done';

const ORDER: Step[] = ['welcome', 'courses', 'deadlines', 'daily', 'done'];

/**
 * Suggestions, not defaults.
 *
 * Nothing is pre-ticked. A checklist that arrives pre-populated is one you
 * start by deleting from, and rule 2 is that every mandatory field is a chance
 * for the thought to evaporate — a mandatory deletion is worse.
 */
const COMMON_DAILY = ['Medication', 'Creatine', 'Read for 20 minutes', 'Tidy desk', 'Walk'];

export function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [courses, setCourses] = useState<Course[]>([]);
  const [busy, setBusy] = useState(false);

  const index = ORDER.indexOf(step);

  async function finish() {
    setBusy(true);
    await finishOnboarding(userId);
    setBusy(false);
    onDone();
  }

  const next = () => setStep(ORDER[Math.min(ORDER.length - 1, index + 1)]);

  return (
    <main className="mx-auto flex min-h-svh max-w-140 flex-col px-6 pb-12 pt-10">
      <Progress index={index} total={ORDER.length - 1} />

      {/* Keyed so each step is a fresh node and re-runs its entrance. */}
      <div key={step} className="step-enter flex flex-1 flex-col">
        {step === 'welcome' && <Welcome onNext={next} onSkip={finish} busy={busy} />}

        {step === 'courses' && (
          <Courses
            userId={userId}
            courses={courses}
            onAdded={(c) => setCourses((list) => [...list, c])}
            onNext={next}
          />
        )}

        {step === 'deadlines' && (
          <Deadlines userId={userId} courses={courses} onNext={next} />
        )}

        {step === 'daily' && <Daily userId={userId} onNext={next} />}

        {step === 'done' && <Done onFinish={() => void finish()} busy={busy} />}
      </div>
    </main>
  );
}

/**
 * Where you are.
 *
 * A filling bar rather than numbered dots: five dots invite counting how many
 * are left, which frames setup as a toll. A bar just shows it is nearly over.
 */
function Progress({ index, total }: { index: number; total: number }) {
  const reduced = useReducedMotion();
  const pct = Math.min(100, (index / total) * 100);

  return (
    <div className="mb-10 h-1 w-full overflow-hidden rounded-pill bg-ink-700">
      <motion.div
        className="h-full rounded-pill bg-t-done"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 30 }}
      />
    </div>
  );
}

/** A step's children, revealed just behind it. */
function Stagger({ children }: { children: React.ReactNode[] }) {
  return (
    <div className="step-stagger flex flex-col gap-6">
      {children.map((child, i) => (
        <div key={i} style={{ '--i': i } as React.CSSProperties}>
          {child}
        </div>
      ))}
    </div>
  );
}

function Welcome({ onNext, onSkip, busy }: { onNext: () => void; onSkip: () => void; busy: boolean }) {
  return (
    <Stagger>
      {[
        <h1 key="h" className="type-display text-text-hi">
          Let's get your term in.
        </h1>,
        <p key="p" className="type-body text-text-mid">
          Three short steps: your courses, your deadlines, and anything you do daily. You can skip
          any of them and add things later.
        </p>,
        <div key="b" className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onNext}>
            Start
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onSkip}>
            Skip setup
          </Button>
        </div>,
      ]}
    </Stagger>
  );
}

function Courses({
  userId,
  courses,
  onAdded,
  onNext,
}: {
  userId: string;
  courses: Course[];
  onAdded: (c: Course) => void;
  onNext: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;

    setBusy(true);
    const created = await createCourse(userId, name, (courses.length % 8) + 1, code);
    setBusy(false);

    if (created) onAdded(created);
    setName('');
    setCode('');
  }

  return (
    <Stagger>
      {[
        <h1 key="h" className="type-h1 text-text-hi">
          What are you taking?
        </h1>,
        <p key="p" className="type-body text-text-mid">
          Courses colour your work and let a pasted syllabus match itself up. The code is optional.
        </p>,
        <form key="f" onSubmit={add} className="flex flex-col gap-4">
          <Field
            label="Course"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Computer Organization"
            autoFocus
          />
          <Field
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="COEN 311"
          />
          <div>
            <Button type="submit" variant="quiet" disabled={!name.trim() || busy}>
              Add course
            </Button>
          </div>
        </form>,
        <div key="c" className="flex flex-wrap gap-2">
          {courses.map((c) => (
            <Chip key={c.id} courseVar={courseVar(c.colour_index)}>
              {c.code ?? c.name}
            </Chip>
          ))}
        </div>,
        <div key="n" className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onNext}>
            {courses.length > 0 ? 'Next' : 'Skip this'}
          </Button>
          {courses.length > 0 && (
            <span className="type-note text-text-low">
              {courses.length} added. Add more any time.
            </span>
          )}
        </div>,
      ]}
    </Stagger>
  );
}

/**
 * The step that does the most work.
 *
 * Pasting one syllabus takes an account from empty to a full term, which no
 * other single action here comes close to. Everything extracted still goes
 * through the same confirmation as anywhere else — rule 6 does not get a
 * discount because someone is new.
 */
function Deadlines({
  userId,
  courses,
  onNext,
}: {
  userId: string;
  courses: Course[];
  onNext: () => void;
}) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<SyllabusItem[] | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState(0);

  async function read() {
    setBusy(true);
    setProblem(null);
    const result = await readSyllabus({ text: text.trim() });
    setBusy(false);

    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    setItems(result.items);
  }

  async function keep() {
    if (!items) return;
    setBusy(true);

    for (const item of items) {
      const isEvent = item.due_date && (item.kind === 'exam' || item.kind === 'presentation');
      if (isEvent) {
        await addEvent(userId, {
          title: item.title,
          kind: item.kind === 'exam' ? 'exam' : 'presentation',
          day: item.due_date as string,
          time: item.due_time,
          course_id: courseId,
        });
      } else {
        await addAssignment(userId, {
          title: item.title,
          course_id: courseId,
          due_at: assignmentDueAt(item.due_date, item.due_time),
          due_has_time: Boolean(item.due_time),
        });
      }
    }

    setBusy(false);
    setAdded(items.length);
    setItems(null);
    setText('');
  }

  if (items) {
    return (
      <Stagger>
        {[
          <h1 key="h" className="type-h1 text-text-hi">
            Found {items.length}.
          </h1>,
          <p key="p" className="type-body text-text-mid">
            Nothing is added until you say so. Anything without a date in the syllabus stays
            undated rather than being guessed at.
          </p>,
          <div key="c" className="flex flex-wrap gap-2">
            {courses.map((c) => (
              <Chip
                key={c.id}
                selected={courseId === c.id}
                onClick={() => setCourseId(courseId === c.id ? null : c.id)}
              >
                {c.code ?? c.name}
              </Chip>
            ))}
          </div>,
          <div key="l" className="flex flex-col">
            {items.map((i, n) => (
              <div
                key={n}
                className="flex items-baseline justify-between gap-4 border-b border-ink-600 py-2 last:border-b-0"
              >
                <span className="type-body text-text-hi">{i.title}</span>
                <span className="type-note shrink-0 text-text-low">
                  {i.due_date ?? 'no date'}
                </span>
              </div>
            ))}
          </div>,
          <div key="b" className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={busy} onClick={() => void keep()}>
              {busy ? 'Adding' : `Add all ${items.length}`}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setItems(null)}>
              Back
            </Button>
          </div>,
        ]}
      </Stagger>
    );
  }

  return (
    <Stagger>
      {[
        <h1 key="h" className="type-h1 text-text-hi">
          Paste a syllabus.
        </h1>,
        <p key="p" className="type-body text-text-mid">
          The evaluation section is enough. Every deadline in it comes back for you to check before
          anything is added — this is the fastest way to fill a whole term.
        </p>,
        <textarea
          key="t"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={'Assignment 1 .... 5%   Due September 25, 2026\nMidterm ......... 25%  October 22, 2026'}
          className="well p-4 type-body text-text-hi placeholder:text-text-low"
        />,
        <div key="b" className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={text.trim().length < 20 || busy} onClick={() => void read()}>
            {busy ? 'Reading' : 'Read it'}
          </Button>
          <Button variant="quiet" onClick={onNext}>
            {added > 0 ? 'Next' : 'Skip this'}
          </Button>
          {added > 0 && <span className="type-note text-t-done">{added} added.</span>}
        </div>,
        problem ? (
          <p key="e" className="type-body text-t-overdue" role="alert">
            {problem}
          </p>
        ) : (
          <span key="e" />
        ),
      ]}
    </Stagger>
  );
}

function Daily({ userId, onNext }: { userId: string; onNext: () => void }) {
  const [added, setAdded] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const busy = useRef(false);

  async function add(title: string) {
    const clean = title.trim();
    if (!clean || busy.current || added.includes(clean)) return;

    busy.current = true;
    await addChecklistItem(
      userId,
      {
        title: clean,
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
      added.length + 1,
    );
    busy.current = false;
    setAdded((a) => [...a, clean]);
    setCustom('');
  }

  return (
    <Stagger>
      {[
        <h1 key="h" className="type-h1 text-text-hi">
          Anything you do every day?
        </h1>,
        <p key="p" className="type-body text-text-mid">
          These show up on Today and can be ticked off. Nothing is pre-selected — pick what is
          actually yours.
        </p>,
        <div key="s" className="flex flex-wrap gap-2">
          {COMMON_DAILY.filter((c) => !added.includes(c)).map((c) => (
            <Chip key={c} onClick={() => void add(c)}>
              {c}
            </Chip>
          ))}
        </div>,
        <form
          key="f"
          onSubmit={(e) => {
            e.preventDefault();
            void add(custom);
          }}
          className="flex gap-2"
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Something else"
            className="well flex-1 type-body text-text-hi placeholder:text-text-low"
          />
          <Button type="submit" variant="quiet" disabled={!custom.trim()}>
            Add
          </Button>
        </form>,
        <div key="a" className="flex flex-wrap gap-2">
          {added.map((a) => (
            <Chip key={a}>{a}</Chip>
          ))}
        </div>,
        <div key="n">
          <Button variant="primary" onClick={onNext}>
            {added.length > 0 ? 'Next' : 'Skip this'}
          </Button>
        </div>,
      ]}
    </Stagger>
  );
}

/**
 * The end.
 *
 * States what is there now rather than congratulating anyone for arriving.
 * Rule 3's spirit applies to first impressions too: praise for completing a
 * setup form is praise for nothing, and it is the tone the rest of the app
 * spends its life avoiding.
 */
function Done({ onFinish, busy }: { onFinish: () => void; busy: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <Stagger>
      {[
        <h1 key="h" className="type-display text-text-hi">
          That's it.
        </h1>,
        <p key="p" className="type-body text-text-mid">
          Today shows what is due and what is left. Capture anything at the top and sort it later —
          it does not need a date, a course or a category to be worth writing down.
        </p>,
        <div key="b">
          <Button variant="primary" disabled={busy || !ready} onClick={onFinish}>
            {busy ? 'One moment' : 'Open my planner'}
          </Button>
        </div>,
      ]}
    </Stagger>
  );
}
