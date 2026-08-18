import { describe, it, expect } from 'vitest';
import {
  impliedCalories,
  totals,
  validateItem,
  validateParse,
} from '../../supabase/functions/_shared/food';

const good = {
  name: 'Chicken breast',
  quantity: 150,
  unit: 'g',
  grams: 150,
  calories: 248,
  protein_g: 46.5,
  carbs_g: 0,
  fat_g: 5.4,
  confident: true,
};

describe('a model response is never trusted as given', () => {
  it('accepts a sane item', () => {
    expect(validateItem(good).item).toMatchObject({ name: 'Chicken breast', calories: 248 });
  });

  it('rejects negative calories', () => {
    // A schema guarantees shape, not sense.
    expect(validateItem({ ...good, calories: -400 }).item).toBeNull();
  });

  it('rejects NaN and Infinity', () => {
    expect(validateItem({ ...good, protein_g: NaN }).item).toBeNull();
    expect(validateItem({ ...good, fat_g: Infinity }).item).toBeNull();
  });

  it('rejects a string where a number belongs', () => {
    expect(validateItem({ ...good, calories: '248' }).item).toBeNull();
  });

  it('rejects an item with no name', () => {
    expect(validateItem({ ...good, name: '   ' }).item).toBeNull();
  });

  it('rejects absurd magnitudes', () => {
    // 50,000 calories in one item is a decimal error or a hallucination, and
    // either way it would silently ruin the day's totals.
    expect(validateItem({ ...good, calories: 50_000 }).item).toBeNull();
    expect(validateItem({ ...good, protein_g: 9_000 }).item).toBeNull();
  });

  it('rejects a non-object outright', () => {
    expect(validateItem('chicken').item).toBeNull();
    expect(validateItem(null).item).toBeNull();
  });

  it('treats missing confidence as not confident', () => {
    // The safe default is the one that shows a warning.
    const { item } = validateItem({ ...good, confident: undefined });
    expect(item?.confident).toBe(false);
  });

  it('treats a truthy non-boolean confidence as not confident', () => {
    expect(validateItem({ ...good, confident: 'yes' }).item?.confident).toBe(false);
  });

  it('keeps optional fields optional', () => {
    const { item } = validateItem({ ...good, quantity: null, unit: null, grams: null });
    expect(item).toMatchObject({ quantity: null, unit: null, grams: null });
  });
});

describe('a whole response', () => {
  it('keeps the good items and reports the bad ones', () => {
    // Losing four good items because the fifth was nonsense would make this
    // worse than typing it in.
    const result = validateParse({
      items: [good, { ...good, name: 'Rice', calories: -1 }, { ...good, name: 'Egg', calories: 78, protein_g: 6.3, carbs_g: 0.6, fat_g: 5.3 }],
    });

    expect(result.items.map((i) => i.name)).toEqual(['Chicken breast', 'Egg']);
    expect(result.warnings.some((w) => /impossible numbers/.test(w.message))).toBe(true);
  });

  it('reports an unusable response rather than inventing an empty day', () => {
    expect(validateParse({}).items).toEqual([]);
    expect(validateParse({}).warnings[0].message).toBe('no items');
    expect(validateParse('nope').items).toEqual([]);
  });

  it('flags anything the model was unsure about', () => {
    const result = validateParse({ items: [{ ...good, name: 'handful of nuts', confident: false }] });
    expect(result.warnings).toContainEqual({ item: 'handful of nuts', message: 'estimated' });
  });

  it('flags calories that disagree with the macros', () => {
    // Catches the case that matters: macros and calories taken from different
    // foods. 46g of protein cannot be 60 calories.
    const result = validateParse({
      items: [{ ...good, calories: 60 }],
    });
    expect(result.warnings.some((w) => /disagree/.test(w.message))).toBe(true);
  });

  it('does not flag ordinary rounding', () => {
    const result = validateParse({ items: [good] });
    expect(result.warnings.some((w) => /disagree/.test(w.message))).toBe(false);
  });

  it('does not flag fibre-heavy or low-calorie foods spuriously', () => {
    // 4/4/9 legitimately breaks for fibre and alcohol, so small items are not
    // second-guessed.
    const lettuce = { ...good, name: 'Lettuce', calories: 5, protein_g: 0.5, carbs_g: 1, fat_g: 0 };
    expect(validateParse({ items: [lettuce] }).warnings.some((w) => /disagree/.test(w.message))).toBe(false);
  });
});

describe('arithmetic', () => {
  it('implies calories with 4/4/9', () => {
    expect(impliedCalories({ ...good, protein_g: 10, carbs_g: 10, fat_g: 10 })).toBe(170);
  });

  it('totals without drifting across many items', () => {
    const many = Array.from({ length: 30 }, () => ({
      calories: 33.3,
      protein_g: 1.1,
      carbs_g: 4.4,
      fat_g: 0.7,
    }));
    expect(totals(many)).toEqual({ calories: 999, protein_g: 33, carbs_g: 132, fat_g: 21 });
  });

  it('totals an empty log to zero rather than undefined', () => {
    expect(totals([])).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});
