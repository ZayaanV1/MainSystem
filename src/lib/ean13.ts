/**
 * Encoding an EAN-13 barcode into its bar pattern.
 *
 * Here so the scanner can be tested without a camera. Rendering a genuine
 * barcode and decoding it end to end is the only way to check the reader
 * actually reads, and a fixture image would be a binary in the repo that
 * nobody can verify by looking at it.
 *
 * It also documents the format the app cares about most: EAN-13 is what is on
 * the back of nearly every packet of food outside North America, and UPC-A is
 * the same thing with a leading zero.
 */

/** Odd parity. Used for the left half. */
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** Even parity. Interleaved with L according to the first digit. */
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/** The right half, which is the L table inverted. */
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/**
 * The first digit is not drawn as bars at all.
 *
 * It is encoded in which of the next six use odd or even parity, which is how
 * thirteen digits fit in twelve digits' worth of space.
 */
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** The 95-module bar pattern, as '0' and '1'. */
export function ean13Bits(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error(`not 13 digits: ${code}`);

  const d = code.split('').map(Number);
  const parity = PARITY[d[0]];

  let bits = '101'; // left guard
  for (let i = 0; i < 6; i += 1) {
    bits += (parity[i] === 'L' ? L : G)[d[i + 1]];
  }
  bits += '01010'; // centre guard
  for (let i = 7; i < 13; i += 1) {
    bits += R[d[i]];
  }
  return `${bits}101`; // right guard
}

/** The check digit for the first twelve digits. */
export function ean13CheckDigit(first12: string): number {
  const sum = first12
    .split('')
    .map(Number)
    .reverse()
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10;
}
