import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Ring } from '../components/Ring';
import { Sheet } from '../components/Sheet';
import { useAuth } from '../lib/auth';
import {
  dayTotals,
  deleteEntry,
  deleteSavedMeal,
  loadDay,
  loadRecentItems,
  logSavedMeal,
  relogItem,
  type NewItem,
  type DietDay,
  type FoodItem,
  type MacroBand,
  type MacroTargets,
  type SavedMeal,
} from '../lib/diet';
import { remainingToday, suggestMeals } from '../lib/mealfit';
import { addDays, formatTime, todayKey } from '../lib/time';
import { LogFood } from './LogFood';
import { TargetEditor } from './TargetEditor';
import { Trend } from './Trend';

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
  const [logging, setLogging] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [editingMeals, setEditingMeals] = useState(false);
  const [recent, setRecent] = useState<NewItem[]>([]);
  const [editingTargets, setEditingTargets] = useState(false);
  const [openMacro, setOpenMacro] = useState<MacroKey | null>(null);

  /**
   * The portion the quick-log chips will use.
   *
   * Defaults to 1, so the common case stays the one tap the spec asks for.
   * Anything else costs one extra tap and is visible the whole time rather
   * than hidden behind a long-press, which is both undiscoverable and easy to
   * trigger by accident while trying to log breakfast.
   */
  const [portion, setPortion] = useState(1);
  const day = todayKey();

  const reload = useCallback(() => loadDay(day).then(setData), [day]);
  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void loadRecentItems(day, addDays(day, -14)).then(setRecent);
  }, [day]);

  if (showTrend) return <Trend onBack={() => setShowTrend(false)} />;

  /*
   * The header renders before the data arrives.
   *
   * Returning null here meant the screen was blank for the ~200ms its fetch
   * took, so the entrance animation played over nothing and the content
   * arrived after it had finished — which reads as the transition lagging,
   * when in fact the transition was already done.
   *
   * Four empty rings are honest: they are the shape of the answer, and they
   * are replaced by the real values rather than by a different layout, so
   * nothing jumps when the data lands.
   */
  if (!data) return <DietSkeleton onBack={onBack} />;

  const sums = dayTotals(data.items);
  const t = data.targets;

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Diet tracker</h1>
        <div className="flex items-baseline gap-4">
          <button type="button" onClick={() => setEditingTargets(true)} className="action-chip type-label">
            Macro targets
          </button>
          <button type="button" onClick={() => setShowTrend(true)} className="action-chip type-label">
            Weight trend
          </button>
          <button type="button" onClick={onBack} className="action-chip type-label lg:hidden">
            Today
          </button>
        </div>
      </header>

      {t ? (
        <section className="mb-8 grid grid-cols-2 gap-6 px-4 lg:grid-cols-4 lg:gap-8">
          <Ring
            label="Calories"
            onClick={() => setOpenMacro('calories')}
            value={sums.calories}
            max={t.calories.max}
            band={t.calories}
            colorVar="--m-calories"
            unit="kcal"
            targetLabel={bandLabel(t.calories)}
          />
          <Ring
            label="Protein"
            onClick={() => setOpenMacro('protein')}
            value={sums.protein_g}
            max={t.protein.max}
            band={t.protein}
            colorVar="--m-protein"
            unit="g"
            targetLabel={bandLabel(t.protein, 'g')}
          />
          <Ring
            label="Carbs"
            onClick={() => setOpenMacro('carbs')}
            value={sums.carbs_g}
            max={t.carbs.max}
            band={t.carbs}
            colorVar="--m-carbs"
            unit="g"
            targetLabel={bandLabel(t.carbs, 'g')}
          />
          <Ring
            label="Fat"
            onClick={() => setOpenMacro('fat')}
            value={sums.fat_g}
            max={t.fat.max}
            band={t.fat}
            colorVar="--m-fat"
            unit="g"
            targetLabel={bandLabel(t.fat, 'g')}
          />
        </section>
      ) : (
        <EmptyState>
          <span>No macro targets yet. Set them with Targets, above.</span>
        </EmptyState>
      )}

      {/*
        Two columns once there is room. The split is by what you are doing:
        the left is for putting food in, the right is for reading back what is
        already there. On a phone they stack in that same order, because
        logging is the reason the screen gets opened.
      */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10">
        <div>
      <div className="mb-8 px-4">
        <Button variant="primary" onClick={() => setLogging(true)}>
          Log food
        </Button>
      </div>

      <MealSuggestions
        data={data}
        onLog={(meal, p) => void logSavedMeal(userId, day, meal, p).then(reload)}
      />

      {(data.savedMeals.length > 0 || recent.length > 0) && (
        <PortionRow portion={portion} onChange={setPortion} />
      )}

      {data.savedMeals.length > 0 && (
        <section className="mb-8">
          <div className="mb-1 flex items-baseline justify-between gap-4 px-4">
            <h2 className="type-h2 text-text-hi">Saved meals</h2>
            <button
              type="button"
              onClick={() => setEditingMeals((v) => !v)}
              className="action-chip type-label"
            >
              {editingMeals ? 'Done' : 'Edit'}
            </button>
          </div>
          <p className="type-note mb-3 px-4 text-text-low">
            {editingMeals
              ? 'Removing a meal leaves what you already logged alone.'
              : portion === 1
                ? 'One tap logs it again.'
                : `One tap logs ${portion} of it.`}
          </p>

          {/*
            Editing is a mode rather than a long-press or a swipe. Both of
            those hide a destructive action behind a gesture with no label,
            and the one thing worse than not finding "delete" is finding it by
            accident while trying to log breakfast.
          */}
          {editingMeals ? (
            <div className="flex flex-col">
              {data.savedMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="flex items-baseline justify-between gap-4 border-b border-ink-600 px-4 py-3"
                >
                  <span className="type-body text-text-hi">{meal.name}</span>
                  <button
                    type="button"
                    onClick={() => void deleteSavedMeal(meal.id).then(reload)}
                    className="action-chip-sm type-caption"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 px-4">
              {data.savedMeals.slice(0, 8).map((meal) => (
                <Chip
                  key={meal.id}
                  onClick={() => void logSavedMeal(userId, day, meal, portion).then(reload)}
                >
                  {meal.name}
                </Chip>
              ))}
            </div>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section className="mb-8">
          <h2 className="type-h2 mb-1 px-4 text-text-hi">Logged recently</h2>
          <p className="type-note mb-3 px-4 text-text-low">
            From the last two weeks. Today's entries are not repeated here.
          </p>
          <div className="flex flex-wrap gap-2 px-4">
            {recent.map((item) => (
              <Chip
                key={item.name}
                onClick={() => void relogItem(userId, day, item, portion).then(reload)}
              >
                {item.name}
              </Chip>
            ))}
          </div>
        </section>
      )}

        </div>

        <div>
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
                      <span className="action-chip-sm type-caption">
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
                          className="action-chip-sm type-caption"
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
                      <p className="mt-1 type-note text-text-low">{entry.raw_text}</p>
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
        </div>
      </div>

      <MacroDetail
        macro={openMacro}
        items={data.items}
        targets={data.targets}
        onClose={() => setOpenMacro(null)}
      />

      <TargetEditor
        open={editingTargets}
        userId={userId}
        current={data.targets}
        onClose={() => setEditingTargets(false)}
        onSaved={reload}
      />

      <LogFood
        open={logging}
        userId={userId}
        day={day}
        onClose={() => setLogging(false)}
        onLogged={reload}
      />
    </main>
  );
}

/**
 * Saved meals that fit what is left of the day.
 *
 * The spec's scenario: "At 6pm the app knows I need 62g of protein and 900
 * calories — surface the saved meals that actually fit."
 *
 * It appears only when there is a gap and something that fits it. Once the day
 * is met it says nothing at all — this answers a question, it does not prompt
 * eating, and a panel that suggested food after you had eaten enough would be
 * the app nagging about a body, which is not its job.
 *
 * There is no model here. It is subtraction over data already loaded, so it
 * costs nothing, needs no network, and still works when the shared free-tier
 * quota is gone — which is exactly when a tired person needs the answer.
 */
function MealSuggestions({
  data,
  onLog,
}: {
  data: DietDay;
  onLog: (meal: SavedMeal, portion: number) => void;
}) {
  const sums = dayTotals(data.items);
  const remaining = remainingToday(sums, data.targets);

  const calorieCeiling = data.targets
    ? Math.max(0, data.targets.calories.max - sums.calories)
    : null;
  const proteinCeiling = data.targets
    ? Math.max(0, data.targets.protein.max - sums.protein_g)
    : null;

  const fits = suggestMeals(data.savedMeals, remaining, {
    calories: calorieCeiling,
    protein: proteinCeiling,
  });
  if (fits.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="type-h2 mb-1 px-4 text-text-hi">What fits</h2>
      <p className="type-note mb-3 px-4 text-text-low">
        {remaining && remaining.protein_g > 0
          ? `${Math.round(remaining.protein_g)} g of protein and ${Math.round(remaining.calories).toLocaleString('en-CA')} kcal left.`
          : `${Math.round(remaining?.calories ?? 0).toLocaleString('en-CA')} kcal left.`}
      </p>

      <div className="flex flex-col">
        {fits.map((fit) => (
          <button
            key={fit.meal.id}
            type="button"
            onClick={() => onLog(fit.meal, fit.portion)}
            className="flex items-baseline justify-between gap-4 border-b border-ink-600 px-4 py-3 text-left last:border-b-0"
          >
            <span className="type-body text-text-hi">
              {fit.meal.name}
              {fit.portion !== 1 && (
                <span className="action-chip-sm type-caption"> {fit.portion}x</span>
              )}
            </span>
            <span className="type-note shrink-0 text-text-low">{fit.why}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type MacroKey = 'calories' | 'protein' | 'carbs' | 'fat';

const MACRO_FIELD: Record<MacroKey, keyof Pick<FoodItem, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'>> = {
  calories: 'calories',
  protein: 'protein_g',
  carbs: 'carbs_g',
  fat: 'fat_g',
};

const MACRO_LABEL: Record<MacroKey, { name: string; unit: string }> = {
  calories: { name: 'Calories', unit: 'kcal' },
  protein: { name: 'Protein', unit: 'g' },
  carbs: { name: 'Carbs', unit: 'g' },
  fat: { name: 'Fat', unit: 'g' },
};

/**
 * What made a ring the size it is.
 *
 * Sorted by contribution rather than by time, because the question a tap on a
 * ring is asking is "where did this come from", and the answer is almost
 * always the top two items. Chronological order buries that under whatever
 * was eaten first.
 *
 * Items contributing nothing to this macro are left out — a black coffee has
 * no business appearing under Protein — but they are counted in the line that
 * says how many were hidden, so the list never looks like the whole day.
 */
function MacroDetail({
  macro,
  items,
  targets,
  onClose,
}: {
  macro: MacroKey | null;
  items: FoodItem[];
  targets: MacroTargets | null;
  onClose: () => void;
}) {
  if (!macro) return null;

  const field = MACRO_FIELD[macro];
  const { name, unit } = MACRO_LABEL[macro];
  const band = targets?.[macro] ?? null;

  const contributing = items
    .filter((i) => i[field] > 0)
    .sort((a, b) => b[field] - a[field]);

  const total = contributing.reduce((n, i) => n + i[field], 0);
  const hidden = items.length - contributing.length;

  const remaining = band
    ? total < band.min
      ? `${Math.round(band.min - total)} ${unit} to reach ${band.min}`
      : total > band.max
        ? `${Math.round(total - band.max)} ${unit} over ${band.max}`
        : `In range, ${Math.round(band.max - total)} ${unit} below the top`
    : null;

  return (
    <Sheet open onClose={onClose} title={name}>
      <div className="flex flex-col gap-6">
        <div>
          <p className="type-display text-text-hi">
            {Math.round(total).toLocaleString('en-CA')} {unit}
          </p>
          {band && (
            <p className="type-note text-text-low">
              Target {band.min}-{band.max} {unit}
            </p>
          )}
          {remaining && <p className="mt-2 type-body text-text-mid">{remaining}</p>}
        </div>

        {contributing.length === 0 ? (
          <p className="type-body text-text-mid">Nothing logged today contributes {name.toLowerCase()}.</p>
        ) : (
          <div className="flex flex-col">
            {contributing.map((item) => (
              <div
                key={item.id}
                className="flex items-baseline justify-between gap-4 border-b border-ink-600 py-3 last:border-b-0"
              >
                <span className="type-body text-text-hi">
                  {item.name}
                  {item.is_estimate && <span className="type-caption text-t-approaching"> estimated</span>}
                </span>
                <span className="type-note shrink-0 text-text-low">
                  {Math.round(item[field] * 10) / 10} {unit}
                  {total > 0 && ` · ${Math.round((item[field] / total) * 100)}%`}
                </span>
              </div>
            ))}
          </div>
        )}

        {hidden > 0 && (
          <p className="type-note text-text-low">
            {hidden} other {hidden === 1 ? 'item' : 'items'} today contributed no {name.toLowerCase()}.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * How much of a saved meal or a recent item a tap logs.
 *
 * Visible rather than hidden, and sticky rather than per-chip: setting it to
 * a half and then logging three things is a real sequence, and re-selecting
 * the portion for each would be worse than the friction it saves.
 *
 * It resets to 1 on every visit to the screen, because a portion left at 2
 * from yesterday is a silent way to log twice what you ate.
 */
const PORTIONS = [0.5, 1, 1.5, 2] as const;

function PortionRow({ portion, onChange }: { portion: number; onChange: (p: number) => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 px-4">
      <span className="action-chip type-label">Portion</span>
      {PORTIONS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={portion === p}
          className={[
            'min-h-[var(--tap)] rounded-pill px-4 type-label',
            portion === p ? 'bg-ink-600 text-text-hi' : 'border border-ink-600 text-text-low',
          ].join(' ')}
        >
          {p === 1 ? '1' : p}
        </button>
      ))}
    </div>
  );
}

/**
 * The diet screen before its data arrives.
 *
 * Renders the real Ring, not a drawn approximation of one. Hand-matching the
 * heights got the jump from 110px down to 36 and no further, and every pixel
 * of that was a number that would drift the next time the ring changed. Using
 * the component means the layout is identical by construction and cannot come
 * apart later.
 *
 * The values are zero and the whole block is dimmed, so it reads as not-yet
 * rather than as a genuine empty day — those are different things and only one
 * of them is true here.
 */
function DietSkeleton({ onBack }: { onBack: () => void }) {
  // A band is passed so the ring renders its status line. Without one that
  // row is absent, which is where forty of the remaining forty-five pixels
  // of jump were hiding.
  const placeholder = [
    { label: 'Calories', unit: 'kcal', colorVar: '--m-calories' },
    { label: 'Protein', unit: 'g', colorVar: '--m-protein' },
    { label: 'Carbs', unit: 'g', colorVar: '--m-carbs' },
    { label: 'Fat', unit: 'g', colorVar: '--m-fat' },
  ];

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="type-h1 text-text-hi">Diet tracker</h1>
        <div className="flex items-baseline gap-4">
          {/* Real buttons, disabled. Spans measured six pixels taller than the
              buttons they stand in for, which moved everything below them. */}
          <button type="button" disabled className="action-chip type-label opacity-40">
            Macro targets
          </button>
          <button type="button" disabled className="action-chip type-label opacity-40">
            Weight trend
          </button>
          <button type="button" onClick={onBack} className="action-chip type-label lg:hidden">
            Today
          </button>
        </div>
      </header>

      <section
        aria-hidden
        className="mb-8 grid grid-cols-2 gap-6 px-4 opacity-40 lg:grid-cols-4 lg:gap-8"
      >
        {placeholder.map((p) => (
          <Ring
            key={p.label}
            label={p.label}
            value={0}
            max={1}
            band={{ min: 0, max: 1 }}
            colorVar={p.colorVar}
            unit={p.unit}
            targetLabel="—"
          />
        ))}
      </section>
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
        <label htmlFor="weight" className="action-chip type-label">
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
