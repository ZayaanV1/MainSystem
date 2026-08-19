import { describe, it, expect } from 'vitest';
import { remainingToday, suggestMeals } from './mealfit';
import type { SavedMeal } from './diet';

const targets = {
  calories: { min: 2900, max: 3100 },
  protein: { min: 160, max: 175 },
  carbs: { min: 350, max: 400 },
  fat: { min: 70, max: 80 },
};

const meal = (name: string, calories: number, protein_g: number): SavedMeal =>
  ({
    id: name,
    name,
    times_logged: 0,
    last_used_at: null,
    items: [{ name, calories, protein_g, carbs_g: 0, fat_g: 0 }],
  }) as unknown as SavedMeal;

describe('remainingToday', () => {
  it('measures against the bottom of the band, which is what is still owed', () => {
    const r = remainingToday({ calories: 2000, protein_g: 98, carbs_g: 200, fat_g: 40 }, targets);
    expect(r).toEqual({ calories: 900, protein_g: 62, carbs_g: 150, fat_g: 30 });
  });

  it('never goes negative once a target is met', () => {
    // A negative gap would invert the scoring and rank the worst meal first.
    const r = remainingToday({ calories: 3200, protein_g: 190, carbs_g: 420, fat_g: 90 }, targets);
    expect(r).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it('says nothing without targets', () => {
    expect(remainingToday({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, null)).toBeNull();
  });
});

describe('suggestMeals', () => {
  // The spec's own scenario: 6pm, 62 g of protein and 900 calories left.
  const remaining = { calories: 900, protein_g: 62, carbs_g: 150, fat_g: 30 };

  it('prefers the meal that closes the protein gap', () => {
    const meals = [
      meal('Bagel', 400, 10),
      meal('Chicken and rice', 700, 55),
      meal('Handful of nuts', 300, 8),
    ];
    const fits = suggestMeals(meals, remaining, { calories: 1100 });
    expect(fits[0].meal.name).toBe('Chicken and rice');
  });

  it('explains itself in numbers rather than claims', () => {
    // Sized so a single portion is the best fit, keeping this about the
    // wording rather than about portion selection.
    const fits = suggestMeals([meal('Chicken and rice', 900, 55)], remaining, { calories: 1100 });
    expect(fits[0].portion).toBe(1);
    expect(fits[0].why).toBe('55 g of the 62 g protein left, 900 kcal');
  });

  it('says when a meal covers the gap outright', () => {
    const fits = suggestMeals([meal('Big shake', 900, 70)], remaining, { calories: 1100 });
    expect(fits[0].why).toBe('Covers the 62 g of protein left, 900 kcal');
  });

  it('scales to the portion that fits best', () => {
    // Half a very large meal is the right suggestion, and 0.5 is a portion the
    // food screen can actually log.
    const fits = suggestMeals([meal('Double shake', 1200, 100)], remaining, { calories: 1100 });
    expect(fits[0].portion).toBe(0.5);
  });

  it('refuses a portion that blows past the calorie ceiling', () => {
    // Every portion of this exceeds what is left before the top of the band.
    const fits = suggestMeals([meal('Enormous', 4000, 200)], remaining, { calories: 1100 });
    expect(fits).toEqual([]);
  });

  it('suggests nothing once the day is met', () => {
    // Silence is deliberate: this answers a question, it does not prompt eating.
    const done = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    expect(suggestMeals([meal('Anything', 500, 40)], done, { calories: 500 })).toEqual([]);
  });

  it('still suggests when only protein is left, not only when calories are', () => {
    const proteinOnly = { calories: 0, protein_g: 40, carbs_g: 0, fat_g: 0 };
    const fits = suggestMeals([meal('Shake', 200, 40)], proteinOnly, { calories: 600 });
    expect(fits).toHaveLength(1);
    expect(fits[0].why).toMatch(/Covers the 40 g/);
  });

  it('does not punish overshooting protein, and breaks the tie toward more', () => {
    // Same calories, both clearing the gap, so the scores are identical — no
    // penalty for overshoot. The tie is then broken toward more protein,
    // which is the point of a lean bulk. Listed worse-first to prove the
    // ordering is doing the work rather than the input order.
    const fits = suggestMeals(
      [meal('Just enough', 700, 62), meal('More than enough', 700, 90)],
      remaining,
      { calories: 1100 },
    );
    expect(fits.map((f) => f.meal.name)).toEqual(['More than enough', 'Just enough']);
    expect(fits[0].score).toBe(fits[1].score);
  });

  it('ignores empty or macro-less saved meals', () => {
    const empty = { id: 'e', name: 'Empty', times_logged: 0, last_used_at: null, items: [] } as unknown as SavedMeal;
    expect(suggestMeals([empty, meal('Zero', 0, 0)], remaining, { calories: 1100 })).toEqual([]);
  });

  it('returns at most the limit, best first', () => {
    // C wins on the numbers: at 1.5 portions it is exactly the 900 kcal left
    // and clears the protein gap, so it scores zero. A and B overshoot the
    // calories. The tiny D is last because it closes almost nothing.
    const meals = [
      meal('A', 700, 55),
      meal('B', 650, 50),
      meal('C', 600, 45),
      meal('D', 100, 2),
    ];
    const fits = suggestMeals(meals, remaining, { calories: 1100 }, 3);
    expect(fits).toHaveLength(3);
    expect(fits.map((f) => f.meal.name)).toEqual(['C', 'B', 'A']);
    expect(fits[0].score).toBe(0);
  });

  it('respects the top of the protein band, not only the calorie one', () => {
    // Found by running this against a real day. With only a calorie ceiling,
    // "Chicken and rice" was offered at 1.5 portions to fill the calorie gap,
    // which put protein 26 g past its band. One portion lands protein squarely
    // in range and leaves the calories a little short, which is the better
    // suggestion — and the app enforces the calorie ceiling, so ignoring the
    // protein one was an inconsistency rather than a decision.
    const chickenAndRice = meal('Chicken and rice', 655, 68.8);

    const ignoringProtein = suggestMeals([chickenAndRice], remaining, { calories: 1100 });
    expect(ignoringProtein[0].portion).toBe(1.5);

    // 175 g band top, 98 g already eaten, so 77 g of headroom.
    const respectingProtein = suggestMeals([chickenAndRice], remaining, {
      calories: 1100,
      protein: 77,
    });
    expect(respectingProtein[0].portion).toBe(1);
  });

  it('still prefers clearing the floor over staying under the ceiling', () => {
    // Overshooting costs a third of what falling short does, so a meal that
    // clears the protein floor must never lose to one that misses it.
    const fits = suggestMeals(
      [meal('Too little', 400, 20), meal('Plenty', 700, 80)],
      remaining,
      { calories: 1100, protein: 77 },
    );
    expect(fits[0].meal.name).toBe('Plenty');
  });

  it('says nothing without targets', () => {
    expect(suggestMeals([meal('X', 500, 40)], null, { calories: 1000 })).toEqual([]);
  });
});
