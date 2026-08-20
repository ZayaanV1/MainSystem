import { describe, it, expect } from 'vitest';
import { checkDigitValid } from './scanner';

/**
 * The check digit is the guard between a misread frame and a confident lookup
 * for a product that does not exist. A decoder working from a blurred frame
 * does occasionally return something well-formed and wrong.
 */
describe('checkDigitValid', () => {
  it('accepts real barcodes', () => {
    // Every one of these is a product this app has actually looked up.
    expect(checkDigitValid('3017620422003')).toBe(true); // Nutella, EAN-13
    expect(checkDigitValid('5449000000996')).toBe(true); // Coca-Cola, EAN-13
    expect(checkDigitValid('0059749877015')).toBe(true); // EAN-13
  });

  it('rejects a single mistyped digit', () => {
    // 3017620422003 with one digit changed. This is the case that matters:
    // it looks entirely plausible and is not a real product.
    expect(checkDigitValid('3017620422013')).toBe(false);
    expect(checkDigitValid('3017620432003')).toBe(false);
  });

  it('rejects a transposition', () => {
    // Two adjacent digits swapped — the classic manual-entry error.
    expect(checkDigitValid('3017620424003')).toBe(false);
  });

  it('handles UPC-A, which is twelve digits', () => {
    expect(checkDigitValid('036000291452')).toBe(true);
    expect(checkDigitValid('036000291453')).toBe(false);
  });

  it('handles EAN-8', () => {
    expect(checkDigitValid('96385074')).toBe(true);
    expect(checkDigitValid('96385075')).toBe(false);
  });

  it('rejects anything that is not a barcode shape', () => {
    for (const bad of ['', '123', 'abcdefghijklm', '30176204220031', '301762042200a']) {
      expect(checkDigitValid(bad)).toBe(false);
    }
  });
});
