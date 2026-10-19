import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import {
  DEFAULT_BOARD,
  MAX_WIDGETS,
  SIZES,
  defaultSize,
  insertionIndex,
  moveWidget,
  normaliseBoard,
  photoCount,
  type Box,
  type Widget,
} from './board';

const w = (id: string, type: Widget['type'] = 'clock', size: Widget['size'] = 's'): Widget => ({ id, type, size, opts: {} });

describe('normaliseBoard', () => {
  it('gives the default board for nothing saved', () => {
    expect(normaliseBoard(null)).toEqual(DEFAULT_BOARD);
    expect(normaliseBoard(undefined)).toEqual(DEFAULT_BOARD);
  });

  it('keeps an empty board empty, which is a choice and not a missing one', () => {
    expect(normaliseBoard([])).toEqual([]);
  });

  it('drops widget types it cannot draw rather than breaking the board', () => {
    const out = normaliseBoard([w('a'), { id: 'b', type: 'weather', size: 's', opts: {} }, w('c', 'goal')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('moves an unsupported size to the nearest larger one the widget has', () => {
    // Day planner has only tall and large: a small one becomes tall.
    expect(normaliseBoard([w('a', 'agenda', 's')])[0].size).toBe('tall');
    // Link has nothing past small: a large one falls back to its default.
    expect(normaliseBoard([w('a', 'link', 'l')])[0].size).toBe('s');
  });

  it('keeps only string options and replaces duplicate ids', () => {
    const out = normaliseBoard([
      { id: 'a', type: 'clock', size: 's', opts: { face: 'flip', n: 3, bad: null } },
      { id: 'a', type: 'due', size: 's', opts: {} },
    ]);
    expect(out[0].opts).toEqual({ face: 'flip' });
    expect(out[1].id).not.toBe('a');
  });

  it('caps the number of widgets', () => {
    const many = Array.from({ length: MAX_WIDGETS + 5 }, (_, i) => w(`w${i}`, 'clock', 'peg'));
    expect(normaliseBoard(many)).toHaveLength(MAX_WIDGETS);
  });
});

describe('sizes', () => {
  it('lets every widget arrive at a size it supports', () => {
    for (const [type, sizes] of Object.entries(SIZES)) {
      expect(sizes).toContain(defaultSize(type as Widget['type']));
    }
  });
});

describe('moveWidget', () => {
  const board = [w('a'), w('b'), w('c'), w('d')];

  it('moves one widget and keeps the rest in order', () => {
    expect(moveWidget(board, 'a', 2).map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveWidget(board, 'd', 0).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('clamps an index past either end', () => {
    expect(moveWidget(board, 'b', 99).map((x) => x.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveWidget(board, 'c', -4).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('leaves the board alone for an unknown id', () => {
    expect(moveWidget(board, 'z', 1).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('insertionIndex', () => {
  // A 400 wide board: two smalls side by side, then a medium under them.
  const boxes: Box[] = [
    { id: 'a', left: 0, top: 0, right: 190, bottom: 190 },
    { id: 'b', left: 210, top: 0, right: 400, bottom: 190 },
    { id: 'c', left: 0, top: 210, right: 400, bottom: 400 },
  ];

  it('splits a small widget left and right', () => {
    expect(insertionIndex(boxes, 40, 90, 'x', 400)).toBe(0);
    expect(insertionIndex(boxes, 160, 90, 'x', 400)).toBe(1);
    expect(insertionIndex(boxes, 260, 90, 'x', 400)).toBe(1);
    expect(insertionIndex(boxes, 380, 90, 'x', 400)).toBe(2);
  });

  it('splits a full-width widget top and bottom', () => {
    expect(insertionIndex(boxes, 200, 250, 'x', 400)).toBe(2);
    expect(insertionIndex(boxes, 200, 380, 'x', 400)).toBe(3);
  });

  it('puts a pointer below everything at the end', () => {
    expect(insertionIndex(boxes, 200, 700, 'x', 400)).toBe(3);
  });

  it('ignores the widget being dragged', () => {
    // Dragging a: the board without it is [b, c]; over b's left half is 0.
    expect(insertionIndex(boxes, 250, 90, 'a', 400)).toBe(0);
    // Over a's old place, b is nearest and the pointer is left of it.
    expect(insertionIndex(boxes, 60, 90, 'a', 400)).toBe(0);
  });

  it('is 0 on an empty board', () => {
    expect(insertionIndex([], 10, 10, 'x', 400)).toBe(0);
  });
});

describe('photoCount', () => {
  it('counts photo widgets only', () => {
    expect(photoCount([w('a', 'photo'), w('b'), w('c', 'photo', 'peg')])).toBe(2);
  });
});
