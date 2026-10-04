import { useState } from 'react';
import { AssignmentRow } from '../components/AssignmentRow';
import { CaptureBox } from '../components/CaptureBox';
import { NowNext } from '../components/NowNext';
import { EventSlip } from '../components/EventSlip';
import { CachedNotice, LoadFailure } from '../components/LoadFailure';
import { Pressable } from '../components/Pressable';
import { SkeletonList } from '../components/Skeleton';
import { UndoBar } from '../components/UndoBar';
import { WeekStrip } from '../components/WeekStrip';
import { groupWeek } from '../lib/week';
import { todayKey } from '../lib/time';
import type { PlannerEvent } from '../lib/planner';
import { SectionHead } from '../components/SectionHead';
import { usePresence } from '../lib/usePresence';
import type { Assignment } from '../lib/planner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { TickPills } from '../components/TickPills';
import type { ChecklistItem } from '../lib/checklist';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { Sheet, SheetPresence } from '../components/Sheet';
import { PromptInput } from '../components/kit/PromptInput';
import { ThinkingText } from '../components/kit/ThinkingText';

/**
 * The design system specimen. Development only — reached at /?specimen.
 *
 * Kept because a design system without a page showing every primitive in every
 * state drifts within two phases. This is where you check that a new component
 * belongs before it lands in a screen, and where the colour law is verifiable
 * by eye: urgency colours only on edges and labels, course colours only as
 * marks.
 */

/** Sample work for the slips, dated from now so every urgency reads true. */
function sampleWork(): Assignment[] {
  const at = (days: number, h: number, m: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const base = {
    course_id: null, due_has_time: true, effort_minutes: null, actual_minutes: null, status: 'todo' as const,
    notes: null, start_by_override: null, remind_at: null, weight_percent: null, grade_percent: null, link: null,
  };
  return [
    { ...base, id: 's1', title: 'Lab report 3: RC circuits', due_at: at(0, 23, 59) },
    { ...base, id: 's2', title: 'WeBWorK set 6', due_at: at(1, 10, 0) },
    { ...base, id: 's3', title: 'Essay outline: the rhetoric of public apology', due_at: at(4, 10, 15) },
    { ...base, id: 's4', title: 'Reading response 4', due_at: at(17, 23, 59) },
  ] as unknown as Assignment[];
}

/** Two classes today, the first starting soon, for the timetable strip. */
function sampleClasses(): PlannerEvent[] {
  const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
  const base = { all_day: false, course_id: null, notes: null, kind: 'lecture', feed_id: null, source: null };
  return [
    { ...base, id: 'e1', title: 'COEN 231 Lecture', starts_at: at(38), ends_at: at(113), location: 'H-937' },
    { ...base, id: 'e2', title: 'PHYS 205 Lab', starts_at: at(150), ends_at: at(330), location: 'EV 3.150' },
  ] as unknown as PlannerEvent[];
}

const URGENCY = [
  { label: 'Overdue', v: '--t-overdue', window: 'past due' },
  { label: 'Critical', v: '--t-critical', window: 'under 48h' },
  { label: 'Urgent', v: '--t-urgent', window: '3-5 days' },
  { label: 'Approaching', v: '--t-approaching', window: '6-14 days' },
  { label: 'Distant', v: '--t-distant', window: '15+ days' },
  { label: 'Done', v: '--t-done', window: 'complete' },
];

const pillItem = (id: string, title: string, doses: number | null = null): ChecklistItem => ({
  id,
  title,
  recurrence: 'daily',
  weekdays: null,
  interval_days: null,
  anchor_day: null,
  active: true,
  sort_order: 0,
  essential: false,
  remind_at: null,
  tracks_doses: doses !== null,
  doses_remaining: doses,
  doses_per_completion: 1,
  refill_warning_days: 5,
});

const SPECIMEN_PILLS: ChecklistItem[] = [
  pillItem('meds', 'Medication', 12),
  pillItem('creatine', 'Creatine', 3),
  pillItem('read', 'Read one chapter'),
];

export function Specimen() {
  const [light, setLight] = useState(false);
  const [lowBattery, setLowBattery] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({ meds: true });
  const [prompt, setPrompt] = useState('');

  const root = document.documentElement;
  root.setAttribute('data-theme', light ? 'light' : 'dark');
  root.setAttribute('data-low-battery', String(lowBattery));

  const toggle = (k: string) => setChecked((c) => ({ ...c, [k]: !c[k] }));

  // A live work list on the same presence as Today, so finishing and
  // deferring can be watched here without an account.
  const [work, setWork] = useState(sampleWork);
  const shown = usePresence(work, (a) => a.id);
  const [opened, setOpened] = useState<Assignment | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const drop = (id: string, kind: 'done' | 'defer') => {
    shown.hint(id, kind);
    setWork((w) => w.filter((a) => a.id !== id));
  };

  return (
    <main className="mx-auto max-w-160 px-4 py-8">
      <h1 className="type-h1 mb-6 px-4 text-text-hi">Specimen</h1>

      <div className="mb-8 flex flex-wrap gap-3 px-4">
        <Button onClick={() => setLight((v) => !v)}>{light ? 'Dark' : 'Light'}</Button>
        <Button onClick={() => setLowBattery((v) => !v)}>
          {lowBattery ? 'Exit low battery' : 'Low battery'}
        </Button>
      </div>

      <Section title="Capture">
        <CaptureBox send={async () => undefined} />
      </Section>

      <Section title="Timetable">
        <NowNext events={sampleClasses()} today={todayKey()} courseFor={() => undefined} />
      </Section>

      <section className="mb-10">
        <SectionHead
          title="Work"
          count={work.length || null}
          aside={
            <Button variant="quiet" onClick={() => setWork(sampleWork())}>
              Put them back
            </Button>
          }
        />
        <div ref={shown.containerRef} className="flex flex-col gap-2.5">
          {shown.list.map(({ item: a, key, leaving }) => (
            <div key={key} data-presence={key} inert={leaving || undefined}>
              <AssignmentRow
                assignment={leaving && shown.hintOf(key) === 'done' ? { ...a, status: 'done' } : a}
                onToggleDone={() => drop(a.id, 'done')}
                onDefer={() => drop(a.id, 'defer')}
                onOpen={() => setOpened(a)}
              />
            </div>
          ))}
        </div>
      </section>

      <Section title="Event slip">
        <div className="flex flex-col gap-2.5 px-4">
          {sampleClasses().map((e) => (
            <EventSlip key={e.id} event={e} />
          ))}
        </div>
      </Section>

      <Section title="WeekStrip — the week's shape, and the way through it">
        <div className="px-4">
          <WeekStrip
            days={groupWeek(work.map((a, i) => ({ ...a, effort_minutes: 45 + i * 30 })), [], todayKey(), 7).days}
            today={todayKey()}
            onJump={() => {}}
          />
        </div>
      </Section>

      <Section title="Loading, after a 150 ms grace">
        <div className="flex flex-col gap-6">
          <SkeletonList rows={2} kind="work" />
          <SkeletonList rows={2} />
        </div>
      </Section>

      <Section title="Failure and offline">
        <LoadFailure failed={['work', 'the checklist']} onRetry={() => undefined} />
        <CachedNotice at={Date.now() - 42 * 60_000} onRetry={() => undefined} />
      </Section>

      <Section title="Pressable row and undo">
        <Card>
          <Pressable className="mat-row gap-3 px-4 py-3" onClick={() => setUndo('“Lab report 3” marked done')}>
            <span className="type-quote text-text-hi">Tap to show the undo bar</span>
          </Pressable>
        </Card>
        <UndoBar message={undo} onUndo={() => setUndo(null)} onDismiss={() => setUndo(null)} />
      </Section>

      <Section title="Time / urgency — edges and labels only">
        <Card>
          {URGENCY.map((u) => (
            <div
              key={u.label}
              className="flex items-center gap-3 border-b border-ink-600 px-4 py-3 last:border-b-0"
            >
              <span
                aria-hidden
                className="h-8 w-[3px] shrink-0 rounded-pill"
                style={{ backgroundColor: `var(${u.v})` }}
              />
              <span className="type-label flex-1 text-text-hi">{u.label}</span>
              <span className="tag type-caption">{u.window}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="CheckRow">
        <Card>
          <CheckRow
            label="Medication"
            done={!!checked.meds}
            onToggle={() => toggle('meds')}
            meta="12 left"
          />
          <CheckRow label="Creatine" done={!!checked.creatine} onToggle={() => toggle('creatine')} />
          <CheckRow
            label="Read one chapter"
            done={!!checked.read}
            onToggle={() => toggle('read')}
            courseVar="--c-2"
          />
        </Card>
      </Section>

      <Section title="TickPills — Today's checklist in one row">
        <div className="px-4">
          <TickPills
            items={SPECIMEN_PILLS}
            isDone={(id) => !!checked[id]}
            onToggle={toggle}
            onOpenList={() => {}}
            onAdd={() => {}}
          />
        </div>
        <div className="mt-3 px-4">
          <TickPills items={[]} isDone={() => false} onToggle={() => {}} onOpenList={() => {}} onAdd={() => {}} />
        </div>
      </Section>

      <Section title="Chip — course marks, never fills">
        <div className="flex flex-wrap gap-2 px-4">
          {['--c-1', '--c-2', '--c-3', '--c-4', '--c-5', '--c-6', '--c-7', '--c-8'].map((c, i) => (
            <Chip key={c} courseVar={c}>
              Course {i + 1}
            </Chip>
          ))}
          <Chip selected onClick={() => {}}>
            Selected
          </Chip>
          <Chip onClick={() => {}}>Tappable</Chip>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3 px-4">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
        </div>
      </Section>

      <Section title="Field">
        <div className="flex flex-col gap-6 px-4">
          <Field label="Title" placeholder="Chem lab report" />
          <Field label="Doses left" type="number" defaultValue={12} hint="Warns at 7 days left" />
          <Field label="Email" defaultValue="not-an-email" error="That isn't an email address." />
        </div>
      </Section>

      <Section title="Empty states">
        <Card>
          <EmptyState>Nothing due this week.</EmptyState>
        </Card>
        <div className="h-3" />
        <Card>
          <EmptyState>Capture anything here. Sort it later.</EmptyState>
        </Card>
      </Section>

      {/*
        The two model-facing controls.

        They were built, styled — their CSS is in index.css — and then wired
        into nothing for weeks, which is precisely the drift this page exists
        to catch. A primitive that never appears here is one nobody checks.
      */}
      <Section title="PromptInput — the composer">
        <div className="flex flex-col gap-4 px-4">
          <PromptInput
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => setPrompt('')}
            label="Specimen composer"
          />
          <PromptInput
            value="A question already being answered"
            onChange={() => {}}
            onSubmit={() => {}}
            busy
            label="Specimen composer, busy"
          />
          <PromptInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            disabledReason="That is enough questions for today. It resets tomorrow, and everything else works as usual."
            label="Specimen composer, spent"
          />
        </div>
      </Section>

      <Section title="ThinkingText — waiting on a model">
        <div className="px-4">
          <ThinkingText />
        </div>
      </Section>

      <Section title="Type scale">
        <Card className="p-4">
          <p className="type-display text-text-hi">2,940</p>
          <p className="type-h1 mt-2 text-text-hi">Screen title</p>
          <p className="type-h2 mt-2 text-text-hi">Section header</p>
          <p className="type-body mt-2 text-text-hi">Body copy at sixteen pixels.</p>
          <p className="type-label mt-2 text-text-mid">Card title and button label</p>
          <p className="type-caption mt-2 text-text-low">Metadata and urgency labels</p>
        </Card>
      </Section>

      <SheetPresence>
        {opened && (
          <Sheet
            open
            dock
            onClose={() => setOpened(null)}
            title={opened.title}
            flightFrom={`[data-row="${opened.id}"] .slip-title`}
          >
            <p className="type-body mb-6 text-text-mid">
              The page recedes, the title flies in from the slip, and closing sends it back.
            </p>
            <Button variant="primary" full onClick={() => setOpened(null)}>
              Done
            </Button>
          </Sheet>
        )}
      </SheetPresence>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="A sheet">
        <p className="type-body mb-6 text-text-mid">
          Enters from the bottom. Closes on Escape, on the backdrop, and on Close.
        </p>
        <Button variant="primary" full onClick={() => setSheetOpen(false)}>
          Done
        </Button>
      </Sheet>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="type-h2 mb-3 px-4 text-text-hi">{title}</h2>
      {children}
    </section>
  );
}
