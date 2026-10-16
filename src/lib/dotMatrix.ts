/**
 * A 5 by 7 dot matrix, the grid an LED clock or a Nothing widget draws on.
 *
 * Drawn here rather than set in a dot-matrix font, for two reasons. A font
 * only draws the dots that are lit, and the look depends on the unlit ones
 * being there too, faintly, so the face reads as a panel rather than as type.
 * And a grid is exact: every glyph is the same width at every size, so the
 * clock never shifts when 1:11 becomes 1:12.
 *
 * The glyphs are the classic 5x7 set, drawn for this file.
 */

const GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

export const MATRIX_ROWS = 7;

/** One dot on the panel: its column, its row, whether it is lit, and whether it belongs to a colon. */
export interface Dot {
  x: number;
  y: number;
  on: boolean;
  colon: boolean;
}

/**
 * Lays a string out on the matrix, one blank column between glyphs, and
 * returns every dot with the panel's width in columns. Characters the set
 * does not have are drawn as a blank cell rather than dropped, so a layout
 * never changes width because of an unexpected character.
 */
export function layoutMatrix(text: string): { dots: Dot[]; cols: number } {
  const dots: Dot[] = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[' '];
    const width = glyph[0].length;
    if (i > 0) x += 1;
    for (let row = 0; row < MATRIX_ROWS; row++) {
      for (let col = 0; col < width; col++) {
        dots.push({ x: x + col, y: row, on: glyph[row][col] === '1', colon: ch === ':' });
      }
    }
    x += width;
  });
  return { dots, cols: x };
}

/**
 * The clock's reading: "9:41" or "12:05", in twelve hours as every other time
 * in the app is written, padded to a fixed four-digit cell so the panel keeps
 * one width all day. The period comes back separately, for a label.
 */
export function clockFace(hour: number, minute: number): { text: string; period: 'AM' | 'PM' } {
  const period = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const text = `${String(h).padStart(2, ' ')}:${String(minute).padStart(2, '0')}`;
  return { text, period };
}
