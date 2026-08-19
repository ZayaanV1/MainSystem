import { describe, it, expect } from 'vitest';
import { isBarcode, productToItem, readProduct, readServingGrams } from './barcode';

/**
 * Built from real Open Food Facts responses. The data is crowd-sourced and
 * uneven, so the cases that matter are the incomplete ones.
 */

const off = (product: Record<string, unknown>) => ({ status: 1, code: '123', product });

describe('readProduct', () => {
  it('reads a complete product', () => {
    // Nutella, as the API actually returns it.
    const p = readProduct(
      off({
        product_name: 'Nutella',
        brands: 'Nutella, Ferrero, Yum yum',
        nutriments: {
          'energy-kcal_100g': 539,
          proteins_100g: 6.3,
          carbohydrates_100g: 57.5,
          fat_100g: 30.9,
        },
      }),
    );

    expect(p).toMatchObject({
      name: 'Nutella',
      brand: 'Nutella',
      per100g: { calories: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9 },
    });
  });

  it('converts kJ when kcal is absent, rather than dropping the product', () => {
    // European labels frequently carry only kJ.
    const p = readProduct(
      off({
        product_name: 'Oat biscuits',
        nutriments: { 'energy-kj_100g': 1900, proteins_100g: 7, carbohydrates_100g: 60, fat_100g: 20 },
      }),
    );
    expect(p?.per100g.calories).toBe(454); // 1900 / 4.184
  });

  it('reports a product with no nutrition panel as a miss', () => {
    // A zero that looks like data is worse than a miss: it would log a real
    // food as contributing nothing and quietly wrong the day's totals.
    expect(readProduct(off({ product_name: 'Mystery item', nutriments: {} }))).toBeNull();
  });

  it('reports a product with a name but no energy as a miss', () => {
    expect(
      readProduct(off({ product_name: 'Thing', nutriments: { proteins_100g: 4 } })),
    ).toBeNull();
  });

  it('treats a missing macro as zero once energy is known', () => {
    // Cola states no protein or fat. Those really are zero.
    const p = readProduct(
      off({
        product_name: 'coca-cola',
        brands: 'Coca-Cola',
        nutriments: { 'energy-kcal_100g': 42, carbohydrates_100g: 10.6, proteins_100g: 0, fat_100g: 0 },
      }),
    );
    expect(p?.per100g).toEqual({ calories: 42, protein_g: 0, carbs_g: 10.6, fat_g: 0 });
  });

  it('is a miss when the product is not found', () => {
    expect(readProduct({ status: 0, status_verbose: 'product not found' })).toBeNull();
  });

  it('is a miss when the product has no name', () => {
    expect(readProduct(off({ product_name: '  ', nutriments: { 'energy-kcal_100g': 100, fat_100g: 1 } }))).toBeNull();
  });

  it('accepts numeric strings, which the API sometimes returns', () => {
    const p = readProduct(
      off({ product_name: 'Rice', nutriments: { 'energy-kcal_100g': '130', carbohydrates_100g: '28' } }),
    );
    expect(p?.per100g.calories).toBe(130);
  });
});

describe('readServingGrams', () => {
  it('reads grams', () => {
    expect(readServingGrams('30 g')).toBe(30);
    expect(readServingGrams('1 bar (45g)')).toBe(45);
  });

  it('refuses millilitres', () => {
    // ml are grams only for water. Treating a serving of oil as if it were
    // would put a wrong number in the log with nothing to show it was assumed.
    expect(readServingGrams('1 portion (330 ml)')).toBeNull();
  });

  it('handles absent or nonsense input', () => {
    expect(readServingGrams(null)).toBeNull();
    expect(readServingGrams('one scoop')).toBeNull();
    expect(readServingGrams('99999 g')).toBeNull();
  });
});

describe('isBarcode', () => {
  it('accepts 8 to 14 digits', () => {
    expect(isBarcode('3017620422003')).toBe(true);
    expect(isBarcode('  5449000000996 ')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isBarcode('123')).toBe(false);
    expect(isBarcode('abcdefgh')).toBe(false);
    expect(isBarcode('123456789012345')).toBe(false);
  });
});

describe('productToItem', () => {
  const nutella = {
    code: '3017620422003',
    name: 'Nutella',
    brand: 'Ferrero',
    per100g: { calories: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9 },
    servingGrams: null,
  };

  it('scales the panel by the weight entered', () => {
    const item = productToItem(nutella, 37);
    expect(item.calories).toBe(199.4);
    expect(item.protein_g).toBe(2.3);
    expect(item.grams).toBe(37);
  });

  it('is not marked as an estimate', () => {
    // A label scaled by a weighed amount is the most exact number in the app.
    expect(productToItem(nutella, 100).is_estimate).toBe(false);
  });

  it('records where the numbers came from', () => {
    expect(productToItem(nutella, 100).source_ref).toBe('off:3017620422003');
  });

  it('names the brand so two similar products are distinguishable', () => {
    expect(productToItem(nutella, 100).name).toBe('Nutella (Ferrero)');
  });

  it('does not repeat the name as its own brand', () => {
    // Open Food Facts returns brands "Nutella, Ferrero, Yum yum" for Nutella,
    // and the first one is the product name again. "Nutella (Nutella)" is
    // noise; the real brand is only worth showing when it distinguishes.
    const selfBranded = { ...nutella, brand: 'Nutella' };
    expect(productToItem(selfBranded, 100).name).toBe('Nutella');
  });
});
