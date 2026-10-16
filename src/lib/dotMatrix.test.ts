import { describe, expect, it } from 'vitest';
import { MATRIX_ROWS, clockFace, layoutMatrix } from './dotMatrix';

describe('the dot-matrix clock', () => {
  it('reads twelve-hour time, as the rest of the app writes it', () => {
    expect(clockFace(0, 5)).toEqual({ text: '12:05', period: 'AM' });
    expect(clockFace(9, 41)).toEqual({ text: ' 9:41', period: 'AM' });
    expect(clockFace(12, 0)).toEqual({ text: '12:00', period: 'PM' });
    expect(clockFace(23, 59)).toEqual({ text: '11:59', period: 'PM' });
  });

  it('keeps one width all day, so the panel never shifts', () => {
    const widths = new Set<number>();
    for (let h = 0; h < 24; h++) for (const m of [0, 1, 11, 59]) widths.add(layoutMatrix(clockFace(h, m).text).cols);
    expect([...widths]).toEqual([5 * 4 + 1 + 4]);
  });

  it('draws every dot of the panel, lit or not', () => {
    const { dots, cols } = layoutMatrix('12:34');
    // Four digits of 5 columns and a colon of 1, each 7 rows tall.
    expect(dots).toHaveLength((5 * 4 + 1) * MATRIX_ROWS);
    expect(cols).toBe(25);
    expect(dots.every((d) => d.x >= 0 && d.x < cols && d.y >= 0 && d.y < MATRIX_ROWS)).toBe(true);
  });

  it('lights exactly the colon dots it should, and marks them as the colon', () => {
    const colon = layoutMatrix('1:2').dots.filter((d) => d.colon);
    expect(colon.filter((d) => d.on).map((d) => d.y)).toEqual([2, 4]);
  });

  it('draws an unknown character as a blank cell rather than dropping it', () => {
    expect(layoutMatrix('1?1').cols).toBe(layoutMatrix('1 1').cols);
    expect(layoutMatrix('?').dots.some((d) => d.on)).toBe(false);
  });
});
