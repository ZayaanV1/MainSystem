import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Ring } from '../components/Ring';
import { useAuth } from '../lib/auth';
import {
  dayTotals,
  deleteEntry,
  loadDay,
  logSavedMeal,
  type DietDay,
  type FoodItem,
  type MacroBand,
} from '../lib/diet';
import { formatTime, todayKey } from '../lib/time';

/**
 * The food log.
 *
 * Four rings, updating the moment anything changes. The rings were built in
 * Phase 0.5 with band support specifically for this: macro targets are ranges,
 * and a ring that collapsed 160-175g of protein to a single number would
 * invent a precision that was never there and then grade you against it.
 *
 * Over-target reads as information, not failure. It continues past the band as
 * a thinner arc in the same hue and never turns red, because there is no red.
 *
 * Every ring carries its number in writing, so colour is never the only signal
 * and the whole thing still works in low-battery mode with the palette
 * desaturated.
 */
export function Diet({ onBack }: { onBack: () => void }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [data, setData] = useState<DietDay | null>(null);
  const day = todayKey();

  const reload = useCallback(() => loadDay(day).then(setData), [day]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!data) return null;

  const sums = dayTotals(data.items);
  const t = data.targets;

  return (
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Food</h1>
        <button type="button" onClick={onBack} className="type-label text-text-mid">
          Today
        </button>
      </header>

      {t ? (
        <section className="mb-8 grid grid-cols-2 gap-6 px-4">
          <Ring
            label="Calories"
            value={sums.calories}
            max={t.calories.max}
            band={t.calories}
            colorVar="--m-calories"
            unit="kcal"
            targetLabel={bandLabel(t.calories)}
          />
          <Ring
            label="Protein"
            value={sums.protein_g}
            max={t.protein.max}
            band={t.protein}
            colorVar="--m-protein"
            unit="g"
            targetLabel={bandLabel(t.protein, 'g')}
          />
          <Ring
            label="Carbs"
            value={sums.carbs_g}
            max={t.carbs.max}
            band={t.carbs}
            colorVar="--m-carbs"
            unit="g"
            targetLabel={bandLabel(t.carbs, 'g')}
          />
          <Ring
            label="Fat"
            value={sums.fat_g}
            max={t.fat.max}
            band={t.fat}
            colorVar="--m-fat"
            unit="g"
            targetLabel={bandLabel(t.fat, 'g')}
          />
        </section>
      ) : (
        <EmptyState>No macro targets set yet.</EmptyState>
      )}

      {data.savedMeals.length > 0 && (
        <section className="mb-8">
          <h2 className="type-h2 mb-1 px-4 text-text-hi">Saved meals</h2>
          <p className="type-caption mb-3 px-4 text-text-low">One tap logs it again.</p>
          <div className="flex flex-wrap gap-2 px-4">
            {data.savedMeals.slice(0, 8).map((meal) => (
              <Chip
                key={meal.id}
                onClick={() => void logSavedMeal(userId, day, meal).then(reload)}
              >
                {meal.name}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8 flex-1">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Today</h2>

        {data.entries.length === 0 ? (
          <EmptyState>Nothing logged yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {data.entries.map((entry) => {
              const items = data.items.filter((i) => i.entry_id === entry.id);
              const entryTotals = dayTotals(items);

              return (
                <Card key={entry.id}>
                  <div className="border-b border-ink-600 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="type-caption text-text-low">
                        {formatTime(new Date(entry.logged_at))}
                        {entry.source !== 'manual' && ` · ${entry.source}`}
                      </span>
                      <div className="flex items-baseline gap-3">
                        <span className="type-caption text-text-mid">
                          {Math.round(entryTotals.calories)} kcal
                        </span>
                        <button
                          type="button"
                          onClick={() => void deleteEntry(entry.id).then(reload)}
                          className="type-caption text-text-low"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/*
                      What was actually typed. This is the provenance of every
                      estimated number on the card: without it "Chicken breast,
                      estimated" gives you no way to tell next week whether you
                      said "150g" or just "a chicken breast", and an estimate
                      you cannot audit is a number you stop trusting.
                    */}
                    {entry.raw_text && (
                      <p className="mt-1 type-quote text-text-low">{entry.raw_text}</p>
                    )}
                  </div>

                  {items.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <WeightRow current={data.weightKg} userId={userId} day={day} onSaved={reload} />
    </main>
  );
}

function bandLabel(band: MacroBand, unit = ''): string {
  const n = (v: number) => Math.round(v).toLocaleString('en-CA');
  return `${n(band.min)}-${n(band.max)}${unit ? ` ${unit}` : ''}`;
}

/**
 * One food.
 *
 * An estimate is marked in writing rather than only by styling. "AI-estimated
 * entries carry an is_estimate flag and render visually distinct from exact
 * ones" — and the written form is what survives the palette desaturating.
 */
function ItemRow({ item }: { item: FoodItem }) {
  const amount = item.grams
    ? `${item.grams} g`
    : item.quantity && item.unit
      ? `${item.quantity} ${item.unit}`
      : item.quantity
        ? String(item.quantity)
        : null;

  return (
    <div className="border-b border-ink-600 px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`type-body ${item.is_estimate ? 'text-text-mid' : 'text-text-hi'}`}>
          {item.name}
        </span>
        <span className="type-caption shrink-0 text-text-low">
          {Math.round(item.calories)} kcal
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 type-caption text-text-low">
        {amount && <span>{amount}</span>}
        <span>P {item.protein_g}</span>
        <span>C {item.carbs_g}</span>
        <span>F {item.fat_g}</span>
        {item.is_estimate && <span className="text-t-approaching">estimated</span>}
      </div>
    </div>
  );
}

/**
 * Bodyweight.
 *
 * One reading a day, and no comment on which direction it moved. The value is
 * in the weekly average against weekly average calories, which is a Phase 3
 * chart rather than a number to react to daily — and a daily number that
 * praised or scolded would be the scale telling you how your day went.
 */
function WeightRow({
  current,
  userId,
  day,
  onSaved,
}: {
  current: number | null;
  userId: string;
  day: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(current === null ? '' : String(current));
  }, [current]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const kg = Number(value);
    if (!Number.isFinite(kg) || kg <= 0) return;

    setSaving(true);
    const { setWeight } = await import('../lib/diet');
    await setWeight(userId, day, kg);
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={submit} className="mb-12 flex items-end gap-3 px-4">
      <div className="flex flex-1 flex-col gap-2">
        <label htmlFor="weight" className="type-label text-text-mid">
          Weight today
        </label>
        <input
          id="weight"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="kg"
          className="w-full rounded-card border border-ink-600 bg-ink-800 px-4 type-body text-text-hi placeholder:text-text-low"
        />
      </div>
      <Button type="submit" disabled={saving || !value}>
        {saving ? 'Saving' : 'Save'}
      </Button>
    </form>
  );
}
