import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import { logEntry, saveMeal, type NewItem } from '../lib/diet';
import { parseFood, readImage } from '../lib/parseFood';
import type { DayKey } from '../lib/time';

/**
 * Logging food.
 *
 * One box: say what you ate. That is the whole capture step, because every
 * extra required field is a chance for the thought to evaporate before it is
 * recorded, and food gets logged in the two minutes after eating or not at all.
 *
 * The parse is then shown for confirmation and never written before it is
 * confirmed. This is rule 6, and the reason is that an estimate which silently
 * lands in the log destroys the distinction between numbers you chose and
 * numbers a model guessed — after which none of them are worth reading.
 *
 * Confirmation is editable rather than a yes/no. A model that got the chicken
 * right and the rice wrong is the common case, and forcing "reject and retype
 * everything" over one wrong number is how a parser stops being used.
 *
 * The parser can always be skipped. It shares a free-tier quota with the
 * chatbot, so being out of requests is routine, and "add them by hand" has to
 * be a visible path rather than a fallback mentioned in an error.
 */

type Stage = 'capture' | 'confirm';

/** An item on the confirmation screen: editable, and not yet written. */
interface DraftItem extends NewItem {
  /** The model said it was unsure. Carried through to `is_estimate`. */
  unsure: boolean;
}

const blankItem = (): DraftItem => ({
  name: '',
  quantity: null,
  unit: null,
  grams: null,
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  unsure: false,
  source_ref: null,
});

export function LogFood({
  open,
  userId,
  day,
  onClose,
  onLogged,
}: {
  open: boolean;
  userId: string;
  day: DayKey;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [stage, setStage] = useState<Stage>('capture');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [items, setItems] = useState<DraftItem[]>([]);
  const [warnings, setWarnings] = useState<{ item: string; message: string }[]>([]);
  const [rawText, setRawText] = useState<string | null>(null);
  const [source, setSource] = useState<'ai' | 'manual' | 'photo'>('manual');
  const [mealName, setMealName] = useState('');

  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setStage('capture');
    setText('');
    setItems([]);
    setWarnings([]);
    setRawText(null);
    setProblem(null);
    setMealName('');
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function runParse(input: { text?: string; image?: { data: string; mimeType: string } }, kind: 'ai' | 'photo') {
    setBusy(true);
    setProblem(null);

    const result = await parseFood(input);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.reason);
      return;
    }

    if (result.items.length === 0) {
      setProblem('Nothing recognisable in that. Add the items by hand.');
      return;
    }

    setItems(
      result.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        grams: i.grams,
        calories: i.calories,
        protein_g: i.protein_g,
        carbs_g: i.carbs_g,
        fat_g: i.fat_g,
        unsure: !i.confident,
        source_ref: null,
      })),
    );
    setWarnings(result.warnings);
    setRawText(result.raw_text);
    setSource(kind);
    setStage('confirm');
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const image = await readImage(file);
    setBusy(false);

    if (!image) {
      setProblem("Couldn't read that photo. Try another, or add the items by hand.");
      return;
    }
    await runParse({ image }, 'photo');
  }

  function startByHand() {
    setItems([blankItem()]);
    setWarnings([]);
    setRawText(text.trim() || null);
    setSource('manual');
    setStage('confirm');
  }

  async function commit(e: FormEvent) {
    e.preventDefault();

    const usable = items.filter((i) => i.name.trim().length > 0);
    if (usable.length === 0) {
      setProblem('Give at least one item a name.');
      return;
    }

    setBusy(true);
    setProblem(null);

    // `unsure` becomes `is_estimate` here, at the one moment it turns into a
    // stored fact. The convention is that estimated entries stay marked for
    // as long as they exist, so this flag must survive the confirmation.
    const toWrite: NewItem[] = usable.map(({ unsure, ...rest }) => ({
      ...rest,
      is_estimate: unsure,
    }));

    const { error } = await logEntry(userId, day, source, toWrite, rawText);

    if (error) {
      setBusy(false);
      setProblem(`Not logged. ${error}`);
      return;
    }

    if (mealName.trim()) await saveMeal(userId, mealName.trim(), toWrite);

    setBusy(false);
    onLogged();
    close();
  }

  const total = items.reduce((n, i) => n + (Number(i.calories) || 0), 0);

  return (
    <Sheet open={open} onClose={close} title={stage === 'capture' ? 'Log food' : 'Check this'}>
      {stage === 'capture' ? (
        <div className="flex flex-col gap-6">
          <Field
            label="What did you eat?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2 eggs, 150g chicken breast, a scoop of whey"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim() && !busy) {
                e.preventDefault();
                void runParse({ text: text.trim() }, 'ai');
              }
            }}
            hint="Rough is fine. You get to check the numbers before anything is saved."
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              disabled={!text.trim() || busy}
              onClick={() => void runParse({ text: text.trim() }, 'ai')}
            >
              {busy ? 'Reading' : 'Work out the macros'}
            </Button>

            <Button type="button" variant="quiet" disabled={busy} onClick={startByHand}>
              Add by hand
            </Button>
          </div>

          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
            <Button type="button" variant="quiet" disabled={busy} onClick={() => fileInput.current?.click()}>
              Use a photo
            </Button>
          </div>

          {problem && (
            <p className="type-body text-t-overdue" role="alert">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={commit} className="flex flex-col gap-6">
          <p className="type-note text-text-low">
            Nothing is saved until you tap Log it. Change anything that looks wrong.
          </p>

          {rawText && source !== 'manual' && (
            <p className="type-quote text-text-low">{rawText}</p>
          )}

          <div className="flex flex-col gap-4">
            {items.map((item, index) => (
              <DraftRow
                key={index}
                item={item}
                onChange={(next) =>
                  setItems((list) => list.map((x, i) => (i === index ? next : x)))
                }
                onRemove={() => setItems((list) => list.filter((_, i) => i !== index))}
              />
            ))}
          </div>

          <Button type="button" variant="quiet" onClick={() => setItems((l) => [...l, blankItem()])}>
            Add another item
          </Button>

          {warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              {warnings.map((w, i) => (
                <p key={i} className="type-caption text-t-approaching">
                  {w.item}: {w.message}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-baseline justify-between border-t border-ink-600 pt-4">
            <span className="type-label text-text-mid">Total</span>
            <span className="type-h2 text-text-hi">{Math.round(total)} kcal</span>
          </div>

          <Field
            label="Save as a meal (optional)"
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
            placeholder="Post-gym shake"
            hint="Saved meals log again in one tap."
          />

          {problem && (
            <p className="type-body text-t-overdue" role="alert">
              {problem}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving' : 'Log it'}
            </Button>
            <Button type="button" variant="quiet" disabled={busy} onClick={() => setStage('capture')}>
              Back
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/**
 * One editable item on the confirmation screen.
 *
 * "Estimated" is a control, not a badge. The model's confidence is a starting
 * position: weighing the chicken after the fact should let you clear the mark,
 * and knowing you guessed at the olive oil should let you set it.
 */
function DraftRow({
  item,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  onChange: (next: DraftItem) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof DraftItem>(key: K, value: DraftItem[K]) =>
    onChange({ ...item, [key]: value });

  const numberField = (
    label: string,
    key: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'grams',
  ) => (
    <label className="flex flex-1 flex-col gap-1">
      <span className="type-caption text-text-low">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        value={item[key] === null ? '' : String(item[key])}
        onChange={(e) => {
          const raw = e.target.value;
          const n = raw === '' ? null : Number(raw);
          set(key, (n === null || Number.isNaN(n) ? (key === 'grams' ? null : 0) : n) as DraftItem[typeof key]);
        }}
        className="w-full rounded-card border border-ink-600 bg-ink-800 px-3 type-body text-text-hi"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3 rounded-card border border-ink-600 p-3">
      <div className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="type-caption text-text-low">Item</span>
          <input
            value={item.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Chicken breast"
            className="w-full rounded-card border border-ink-600 bg-ink-800 px-3 type-body text-text-hi placeholder:text-text-low"
          />
        </label>
        <button type="button" onClick={onRemove} className="type-caption pb-3 text-text-low">
          Remove
        </button>
      </div>

      <div className="flex gap-2">
        {numberField('Grams', 'grams')}
        {numberField('Kcal', 'calories')}
      </div>

      <div className="flex gap-2">
        {numberField('Protein', 'protein_g')}
        {numberField('Carbs', 'carbs_g')}
        {numberField('Fat', 'fat_g')}
      </div>

      <button
        type="button"
        onClick={() => set('unsure', !item.unsure)}
        aria-pressed={item.unsure}
        className="flex items-center gap-3 text-left"
      >
        <span
          aria-hidden
          className={[
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
            item.unsure ? 'border-t-approaching bg-t-approaching' : 'border-ink-600',
          ].join(' ')}
        />
        <span className="type-caption text-text-mid">Estimated</span>
      </button>
    </div>
  );
}
