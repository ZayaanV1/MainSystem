import { describe, it, expect } from 'vitest';
import { ean13Bits, ean13CheckDigit } from './ean13';
import { checkDigitValid } from './scanner';

describe('ean13Bits', () => {
  it('produces the 95 modules the format defines', () => {
    expect(ean13Bits('3017620422003')).toHaveLength(95);
  });

  it('starts, centres and ends with the guard patterns', () => {
    const bits = ean13Bits('3017620422003');
    expect(bits.startsWith('101')).toBe(true);
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.endsWith('101')).toBe(true);
  });

  it('encodes the first digit as a parity pattern rather than as bars', () => {
    // Same last twelve digits, different first: only the parity of the left
    // half changes, which is the whole trick of the format.
    const a = ean13Bits('0017620422003');
    const b = ean13Bits('3017620422003');
    expect(a).not.toBe(b);
    expect(a.slice(45)).toBe(b.slice(45)); // right half identical
  });

  it('refuses anything that is not thirteen digits', () => {
    expect(() => ean13Bits('301762042200')).toThrow();
    expect(() => ean13Bits('30176204220031')).toThrow();
  });
});

describe('ean13CheckDigit', () => {
  it('computes the digit real barcodes carry', () => {
    expect(ean13CheckDigit('301762042200')).toBe(3); // Nutella
    expect(ean13CheckDigit('544900000099')).toBe(6); // Coca-Cola
  });

  it('agrees with the validator the scanner uses', () => {
    // Two implementations of the same rule, checked against each other: the
    // encoder builds the digit, the scanner verifies it.
    for (const body of ['301762042200', '544900000099', '005974987701']) {
      expect(checkDigitValid(body + ean13CheckDigit(body))).toBe(true);
    }
  });
});
