import { useState } from 'react';
import { formatDay, todayKey, zoneAbbrev } from './lib/time';

/**
 * TEMPORARY — foundation specimen.
 *
 * This is not a screen in the app. It exists so Phase 0.5 can be checked by
 * eye: that every token resolves, that light mode and low-battery mode restyle
 * the whole interface from one attribute, and that the fonts loaded. It gets
 * deleted the moment the Today view exists.
 */

const URGENCY = [
  { label: 'Overdue', cls: 'bg-t-overdue', window: 'past due' },
  { label: 'Critical', cls: 'bg-t-critical', window: 'under 48h' },
  { label: 'Urgent', cls: 'bg-t-urgent', window: '3-5 days' },
  { label: 'Approaching', cls: 'bg-t-approaching', window: '6-14 days' },
  { label: 'Distant', cls: 'bg-t-distant', window: '15+ days' },
  { label: 'Done', cls: 'bg-t-done', window: 'complete' },
];

const MACROS = [
  { label: 'Calories', cls: 'text-m-calories', value: '2,940', target: '2,900-3,100' },
  { label: 'Protein', cls: 'text-m-protein', value: '168', target: '160-175 g' },
  { label: 'Carbs', cls: 'text-m-carbs', value: '372', target: '350-400 g' },
  { label: 'Fat', cls: 'text-m-fat', value: '74', target: '70-80 g' },
];

const COURSES = ['bg-c-1', 'bg-c-2', 'bg-c-3', 'bg-c-4', 'bg-c-5', 'bg-c-6', 'bg-c-7', 'bg-c-8'];

export default function App() {
  const [light, setLight] = useState(false);
  const [lowBattery, setLowBattery] = useState(false);

  // Both modes are driven entirely by a root attribute. No component below
  // knows which mode it is in, which is the point.
  const root = document.documentElement;
  root.setAttribute('data-theme', light ? 'light' : 'dark');
  root.setAttribute('data-low-battery', String(lowBattery));

  const today = todayKey();

  return (
    <main className="mx-auto max-w-160 p-6">
      <header className="mb-8">
        <h1 className="type-h1 text-text-hi">Foundation</h1>
        <p className="type-body mt-2 text-text-mid">
          {formatDay(today)} &middot; {zoneAbbrev()} &middot; America/Toronto
        </p>
      </header>

      <div className="mb-8 flex gap-3">
        <button
          onClick={() => setLight((v) => !v)}
          className="rounded-pill border border-ink-600 bg-ink-800 px-4 type-label text-text-hi"
        >
          {light ? 'Dark mode' : 'Light mode'}
        </button>
        <button
          onClick={() => setLowBattery((v) => !v)}
          className="rounded-pill border border-ink-600 bg-ink-800 px-4 type-label text-text-hi"
        >
          {lowBattery ? 'Exit low battery' : 'Low battery'}
        </button>
      </div>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 text-text-hi">Time / urgency</h2>
        <div className="overflow-hidden rounded-card bg-ink-800">
          {URGENCY.map((u) => (
            <div key={u.label} className="flex items-center gap-3 border-b border-ink-600 px-4 last:border-b-0">
              <span className={`h-8 w-1 shrink-0 rounded-pill ${u.cls}`} aria-hidden />
              <span className="type-label flex-1 text-text-hi">{u.label}</span>
              <span className="type-caption text-text-low">{u.window}</span>
            </div>
          ))}
        </div>
        <p className="type-caption mt-2 text-text-low">Every state carries a label, not just a colour</p>
      </section>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 text-text-hi">Macros</h2>
        <div className="grid grid-cols-2 gap-3">
          {MACROS.map((m) => (
            <div key={m.label} className="rounded-card bg-ink-800 p-4">
              <div className="type-caption text-text-low">{m.label}</div>
              <div className={`type-display mt-1 ${m.cls}`}>{m.value}</div>
              <div className="type-caption mt-1 text-text-mid">{m.target}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="type-h2 mb-3 text-text-hi">Courses</h2>
        <div className="flex flex-wrap gap-2">
          {COURSES.map((c, i) => (
            <span key={c} className="flex items-center gap-2 rounded-card bg-ink-800 px-3 py-2">
              <span className={`h-1.5 w-1.5 rounded-pill ${c}`} aria-hidden />
              <span className="type-label text-text-hi">Course {i + 1}</span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="type-h2 mb-3 text-text-hi">Type</h2>
        <div className="rounded-card bg-ink-800 p-4">
          <p className="type-display text-text-hi">2,940</p>
          <p className="type-h1 mt-2 text-text-hi">Screen title</p>
          <p className="type-h2 mt-2 text-text-hi">Section header</p>
          <p className="type-body mt-2 text-text-hi">Body copy sits here at sixteen pixels.</p>
          <p className="type-label mt-2 text-text-mid">Card title and button label</p>
          <p className="type-caption mt-2 text-text-low">Metadata and urgency labels</p>
        </div>
      </section>
    </main>
  );
}
