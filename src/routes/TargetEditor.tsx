import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import {
  loadTargetHistory,
  saveTargets,
  type MacroBand,
  type MacroTargets,
} from '../lib/diet';
import { todayKey, type DayKey } from '../lib/time';

/**
 * Editing the macro targets.
 *
 * Targets are ranges, so the editor asks for ranges. There is no single-number
 * mode: collapsing 160-175 g to 167.5 would invent a precision that was never
 * there and then grade every day against it.
 *
 * Saving writes a new version rather than changing the old one. The effective
 * date is shown and editable precisely because that is the mechanism — if it
 * were hidden, "changing my protein goal" would silently mean "deciding I was
 * off target every day in July", which is the one thing the versioning exists
 * to prevent. The history below makes that visible rather than merely true.
 */

type Key = 'calories' | 'protein' | 'carbs' | 'fat';

const ROWS: { key: Key; label: string; unit: string }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

type Draft = Record<Key, { min: string; max: string }>;

const toDraft = (t: MacroTargets | null): Draft => ({
  calories: band(t?.calories, 2900, 3100),
  protein: band(t?.protein, 160, 175),
  carbs: band(t?.carbs, 350, 400),
  fat: band(t?.fat, 70, 80),
});

const band = (b: MacroBand | undefined, min: number, max: number) => ({
  min: String(b?.min ?? min),
  max: String(b?.max ?? max),
});

export function TargetEditor({
  open,
  userId,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  userId: string;
  current: MacroTargets | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(current));
  const [from, setFrom] = useState<DayKey>(todayKey());
  const [history, setHistory] = useState<MacroTargets[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(current));
      setFrom(todayKey());
      setProblem(null);
      void loadTargetHistory().then(setHistory);
    }
  }, [open, current]);

  const set = (key: Key, edge: 'min' | 'max', value: string) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], [edge]: value } }));

  async function submit(e: FormEvent) {
    e.preventDefault();

    const parsed: Partial<Record<Key, MacroBand>> = {};
    for (const { key, label } of ROWS) {
      const min = Number(draft[key].min);
      const max = Number(draft[key].max);

      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) {
        setProblem(`${label} needs two numbers.`);
        return;
      }
      if (min > max) {
        setProblem(`${label}'s low end is above its high end.`);
        return;
      }
      parsed[key] = { min, max };
    }

    setSaving(true);
    const { error } = await saveTargets(userId, from, parsed as Record<Key, MacroBand>);
    setSaving(false);

    if (error) {
      setProblem(`Not saved. ${error}`);
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Macro targets">
      <form onSubmit={submit} className="flex flex-col gap-6">
        <p className="type-note text-text-low">
          Targets are ranges. Saving adds a new version from the date below and
          leaves earlier days reading the targets they were set under.
        </p>

        <div className="flex flex-col gap-4">
          {ROWS.map(({ key, label, unit }) => (
            <div key={key} className="flex items-end gap-3">
              <span className="type-label w-20 shrink-0 text-text-mid">{label}</span>
              <label className="flex flex-1 flex-col gap-1">
                <span className="action-chip-sm type-caption">Low</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={draft[key].min}
                  onChange={(e) => set(key, 'min', e.target.value)}
                  className="w-full rounded-card border border-ink-600 bg-ink-800 px-3 type-body text-text-hi"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="action-chip-sm type-caption">High</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={draft[key].max}
                  onChange={(e) => set(key, 'max', e.target.value)}
                  className="w-full rounded-card border border-ink-600 bg-ink-800 px-3 type-body text-text-hi"
                />
              </label>
              <span className="type-caption w-10 shrink-0 pb-3 text-text-low">{unit}</span>
            </div>
          ))}
        </div>

        <label className="flex flex-col gap-2">
          <span className="action-chip type-label">In force from</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom((e.target.value || todayKey()) as DayKey)}
            className="w-full rounded-card border border-ink-600 bg-ink-800 px-4 type-body text-text-hi"
          />
          <span className="type-note text-text-low">
            Days before this keep the targets they already had.
          </span>
        </label>

        {problem && (
          <p className="type-body text-t-overdue" role="alert">
            {problem}
          </p>
        )}

        <div>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving' : 'Save targets'}
          </Button>
        </div>

        {history.length > 0 && (
          <section className="border-t border-ink-600 pt-6">
            <h3 className="type-h2 mb-3 text-text-hi">Earlier versions</h3>
            <div className="flex flex-col gap-3">
              {history.map((t) => (
                <div key={t.effective_from} className="flex flex-col gap-1">
                  <span className="action-chip type-label">From {t.effective_from}</span>
                  <span className="type-note text-text-low">
                    {t.calories.min}-{t.calories.max} kcal · P {t.protein.min}-{t.protein.max} · C{' '}
                    {t.carbs.min}-{t.carbs.max} · F {t.fat.min}-{t.fat.max}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </form>
    </Sheet>
  );
}
