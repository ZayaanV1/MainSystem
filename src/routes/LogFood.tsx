import { useRef, useState, type FormEvent } from 'react';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import { logEntry, saveMeal, type FoodEntry, type NewItem } from '../lib/diet';
import { isBarcode, lookupBarcode, productToItem, type BarcodeProduct } from '../lib/barcode';
import { scanSupport } from '../lib/scanner';
import { ScanBarcode } from './ScanBarcode';
import { parseFood, readImage } from '../lib/parseFood';
import { foodToItem, searchFoods, type UsdaFood } from '../lib/usda';
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
  const [source, setSource] = useState<FoodEntry['source']>('manual');
  const [mealName, setMealName] = useState('');

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<UsdaFood[] | null>(null);
  const [picked, setPicked] = useState<UsdaFood | null>(null);
  const [pickedGrams, setPickedGrams] = useState('100');

  const [scanning, setScanning] = useState(false);

  const [code, setCode] = useState('');
  const [scanned, setScanned] = useState<BarcodeProduct | null>(null);
  const [grams, setGrams] = useState('100');

  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setStage('capture');
    setText('');
    setItems([]);
    setWarnings([]);
    setRawText(null);
    setProblem(null);
    setMealName('');
    setCode('');
    setScanning(false);
    setScanned(null);
    setGrams('100');
    setQuery('');
    setMatches(null);
    setPicked(null);
    setPickedGrams('100');
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function runParse(input: { text?: string; image?: { data: string; mimeType: string } }, kind: FoodEntry['source']) {
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

  async function search() {
    setBusy(true);
    setProblem(null);
    setPicked(null);

    const result = await searchFoods(query);
    setBusy(false);

    if (!result.ok) {
      setMatches(null);
      setProblem(result.reason);
      return;
    }

    setMatches(result.foods);
  }

  function acceptPicked() {
    if (!picked) return;
    const weight = Number(pickedGrams);
    if (!Number.isFinite(weight) || weight <= 0) {
      setProblem('Enter how many grams you had.');
      return;
    }

    setItems([{ ...foodToItem(picked, weight), unsure: false }]);
    setWarnings([]);
    setRawText(`${picked.description} · USDA ${picked.fdcId}`);
    setSource('search');
    setPicked(null);
    setMatches(null);
    setStage('confirm');
  }

  async function lookUp() {
    await lookUpCode(code);
  }

  async function lookUpCode(value: string) {
    setBusy(true);
    setProblem(null);
    const result = await lookupBarcode(value);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.reason);
      return;
    }

    setScanned(result.product);
    // A stated serving is a better first guess than 100 g, but it is only a
    // default: the box on the counter is the thing being weighed.
    setGrams(String(result.product.servingGrams ?? 100));
  }

  function acceptScanned() {
    if (!scanned) return;
    const weight = Number(grams);
    if (!Number.isFinite(weight) || weight <= 0) {
      setProblem('Enter how many grams you had.');
      return;
    }

    setItems([{ ...productToItem(scanned, weight), unsure: false }]);
    setWarnings([]);
    setRawText(`${scanned.name} · barcode ${scanned.code}`);
    setSource('barcode');
    setScanned(null);
    setStage('confirm');
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

          {/*
            Searching the USDA reference data, which is the right answer for
            unbranded food: "150 g chicken breast" has a measured value, and
            asking a language model to recall it is strictly worse than
            looking it up. Branded products are excluded here because they are
            barcode territory, below.
          */}
          <div className="flex flex-col gap-3 border-t border-ink-600 pt-6">
            <Field
              label="Or search a food"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMatches(null);
                setPicked(null);
              }}
              placeholder="chicken breast raw"
              hint="Measured reference values from USDA FoodData Central."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim().length > 1 && !busy) {
                  e.preventDefault();
                  void search();
                }
              }}
            />

            <div>
              <Button
                type="button"
                variant="quiet"
                disabled={query.trim().length < 2 || busy}
                onClick={() => void search()}
              >
                {busy ? 'Searching' : 'Search'}
              </Button>
            </div>

            {matches && !picked && (
              <div className="flex flex-col">
                {matches.map((food) => (
                  <Pressable align="start" className="flex-col gap-1 border-b border-ink-600 py-3 last:border-b-0"
                    key={food.fdcId}
                    onClick={() => {
                      setPicked(food);
                      setPickedGrams('100');
                    }}>
                    <span className="type-body text-text-hi">{food.description}</span>
                    <span className="type-note text-text-low">
                      Per 100 g: {food.per100g.calories} kcal, P {food.per100g.protein_g}, C{' '}
                      {food.per100g.carbs_g}, F {food.per100g.fat_g}
                    </span>
                  </Pressable>
                ))}
              </div>
            )}

            {picked && (
              <div className="flex flex-col gap-3 rounded-card border border-ink-600 p-3">
                <p className="type-body text-text-hi">{picked.description}</p>
                <p className="type-note text-text-low">
                  Per 100 g: {picked.per100g.calories} kcal, P {picked.per100g.protein_g}, C{' '}
                  {picked.per100g.carbs_g}, F {picked.per100g.fat_g}
                </p>

                <Field
                  label="How many grams?"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  value={pickedGrams}
                  onChange={(e) => setPickedGrams(e.target.value)}
                />

                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="primary" onClick={acceptPicked}>
                    Use this
                  </Button>
                  <Button type="button" variant="quiet" onClick={() => setPicked(null)}>
                    Pick another
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/*
            Barcodes are typed rather than scanned. iOS Safari has no
            BarcodeDetector, and a camera scanner built on a decoding library
            is a large dependency for a path that already works: the number is
            printed under every barcode, and a packet is in your hand when you
            are logging it.

            The lookup is Open Food Facts, which is free and needs no key.
          */}
          <div className="flex flex-col gap-3 border-t border-ink-600 pt-6">
            <Field
              label="Or type a barcode"
              value={code}
              inputMode="numeric"
              onChange={(e) => {
                setCode(e.target.value);
                setScanned(null);
              }}
              placeholder="3017620422003"
              hint="The digits printed under the barcode. Looked up in Open Food Facts."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isBarcode(code) && !busy) {
                  e.preventDefault();
                  void lookUp();
                }
              }}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="quiet" disabled={!isBarcode(code) || busy} onClick={() => void lookUp()}>
                {busy ? 'Looking up' : 'Look it up'}
              </Button>

              {/*
                Offered only where it can work. A scan button that opens a
                camera and then cannot decode anything is worse than no button,
                and typing the digits remains right here either way.
              */}
              {scanSupport() !== 'none' && !scanning && (
                <Button type="button" variant="quiet" disabled={busy} onClick={() => setScanning(true)}>
                  Scan it
                </Button>
              )}
            </div>

            {scanning && (
              <ScanBarcode
                onCancel={() => setScanning(false)}
                onFound={(found) => {
                  setScanning(false);
                  setCode(found);
                  // Straight into the lookup: the scan already confirmed the
                  // digits twice over, so asking for another tap would be
                  // asking someone to confirm what they just pointed at.
                  void lookUpCode(found);
                }}
              />
            )}

            {scanned && (
              <div className="flex flex-col gap-3 rounded-card border border-ink-600 p-3">
                <div>
                  <p className="type-body text-text-hi">{scanned.name}</p>
                  {scanned.brand && <p className="type-note text-text-low">{scanned.brand}</p>}
                </div>

                <p className="type-note text-text-low">
                  Per 100 g: {scanned.per100g.calories} kcal, P {scanned.per100g.protein_g}, C{' '}
                  {scanned.per100g.carbs_g}, F {scanned.per100g.fat_g}
                </p>

                <Field
                  label="How many grams?"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  hint={scanned.servingGrams ? 'One stated serving, unless you weighed it.' : undefined}
                />

                <div>
                  <Button type="button" variant="primary" onClick={acceptScanned}>
                    Use this
                  </Button>
                </div>
              </div>
            )}
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

          {rawText && <p className="type-note text-text-low">{rawText}</p>}

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
            <span className="tag type-label">Total</span>
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
      <span className="kicker">{label}</span>
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
        className="well px-3 type-body text-text-hi"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3 rounded-card border border-ink-600 p-3">
      <div className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="kicker">Item</span>
          <input
            value={item.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Chicken breast"
            className="well px-3 type-body text-text-hi placeholder:text-text-low"
          />
        </label>
        <Button variant="quiet" size="sm" onClick={onRemove}>
          Remove
        </Button>
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

      <Pressable className="gap-3"
        onClick={() => set('unsure', !item.unsure)}
        aria-pressed={item.unsure}>
        <span
          aria-hidden
          className={[
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border-2',
            item.unsure ? 'border-t-approaching bg-t-approaching' : 'border-ink-600',
          ].join(' ')}
        />
        <span className="type-caption text-text-mid">Estimated</span>
      </Pressable>
    </div>
  );
}
