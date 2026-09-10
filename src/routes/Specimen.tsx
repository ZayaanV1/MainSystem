import { useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { Ring } from '../components/Ring';
import { Sheet } from '../components/Sheet';
import { PromptInput } from '../components/kit/PromptInput';
import { ThinkingText } from '../components/kit/ThinkingText';

/**
 * The design system specimen. Development only — reached at /?specimen.
 *
 * Kept because a design system without a page showing every primitive in every
 * state drifts within two phases. This is where you check that a new component
 * belongs before it lands in a screen, and where the colour law is verifiable
 * by eye: urgency colours only on edges and labels, macro colours only on
 * rings, course colours only as marks.
 */

const URGENCY = [
  { label: 'Overdue', v: '--t-overdue', window: 'past due' },
  { label: 'Critical', v: '--t-critical', window: 'under 48h' },
  { label: 'Urgent', v: '--t-urgent', window: '3-5 days' },
  { label: 'Approaching', v: '--t-approaching', window: '6-14 days' },
  { label: 'Distant', v: '--t-distant', window: '15+ days' },
  { label: 'Done', v: '--t-done', window: 'complete' },
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

  return (
    <main className="mx-auto max-w-160 px-4 py-8">
      <h1 className="type-h1 mb-6 px-4 text-text-hi">Specimen</h1>

      <div className="mb-8 flex flex-wrap gap-3 px-4">
        <Button onClick={() => setLight((v) => !v)}>{light ? 'Dark' : 'Light'}</Button>
        <Button onClick={() => setLowBattery((v) => !v)}>
          {lowBattery ? 'Exit low battery' : 'Low battery'}
        </Button>
      </div>

      <Section title="Ring — macros, with target bands">
        <div className="grid grid-cols-2 gap-6 px-4">
          <Ring
            label="Calories"
            value={2940}
            max={3100}
            band={{ min: 2900, max: 3100 }}
            colorVar="--m-calories"
            unit="kcal"
            targetLabel="2,900-3,100"
          />
          <Ring
            label="Protein"
            value={168}
            max={175}
            band={{ min: 160, max: 175 }}
            colorVar="--m-protein"
            unit="g"
            targetLabel="160-175 g"
          />
          <Ring
            label="Carbs"
            value={210}
            max={400}
            band={{ min: 350, max: 400 }}
            colorVar="--m-carbs"
            unit="g"
            targetLabel="350-400 g"
          />
          {/* Over target. Reads as information, continues past the band as a
              thinner arc, and does not turn red — because there is no red. */}
          <Ring
            label="Fat"
            value={96}
            max={80}
            band={{ min: 70, max: 80 }}
            colorVar="--m-fat"
            unit="g"
            targetLabel="70-80 g"
          />
        </div>
      </Section>

      <Section title="Ring — checklist completion, same geometry">
        <div className="px-4">
          <Ring label="Checklist" value={3} max={5} colorVar="--t-done" targetLabel="3 of 5" />
        </div>
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
            disabledReason="That is enough questions for today — the rest of the daily model budget is kept for logging food. It resets tomorrow."
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
