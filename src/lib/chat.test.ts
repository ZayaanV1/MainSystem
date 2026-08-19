import { describe, it, expect } from 'vitest';
import { validateChat } from '../../supabase/functions/_shared/chat';

/**
 * "A confidently wrong deadline is worse than no chatbot." Everything here is
 * about that sentence: an id the model was never given is a fabrication, and a
 * proposed action built on one must never reach a confirmation screen, where
 * it would look exactly as legitimate as a real one.
 */

const known = new Set(['a-1', 'item-1', 'meal-1']);

describe('validateChat', () => {
  it('keeps a plain answer', () => {
    const r = validateChat({ reply: 'Two things are due this week.', referenced: ['a-1'] }, known);
    expect(r.reply).toBe('Two things are due this week.');
    expect(r.referenced).toEqual(['a-1']);
    expect(r.warnings).toEqual([]);
    expect(r.action).toBeNull();
  });

  it('drops a reference to something it was never given', () => {
    const r = validateChat({ reply: 'Your essay is due Friday.', referenced: ['a-1', 'ghost'] }, known);
    expect(r.referenced).toEqual(['a-1']);
    expect(r.warnings[0]).toMatch(/not in your data/);
  });

  it('deduplicates references', () => {
    const r = validateChat({ reply: 'x', referenced: ['a-1', 'a-1'] }, known);
    expect(r.referenced).toEqual(['a-1']);
  });

  it('substitutes an honest sentence when the reply is missing', () => {
    expect(validateChat({ referenced: [] }, known).reply).toBe('I could not put together an answer to that.');
    expect(validateChat({ reply: '   ', referenced: [] }, known).reply).toMatch(/could not/);
  });

  describe('add_assignment', () => {
    it('keeps a titled proposal', () => {
      const r = validateChat(
        { reply: 'Adding that.', referenced: [], action: { kind: 'add_assignment', title: 'Essay draft', due_date: '2026-10-15', due_time: '23:59' } },
        known,
      );
      expect(r.action).toEqual({ kind: 'add_assignment', title: 'Essay draft', due_date: '2026-10-15', due_time: '23:59' });
    });

    it('drops one with no title', () => {
      const r = validateChat({ reply: 'x', referenced: [], action: { kind: 'add_assignment', title: '  ' } }, known);
      expect(r.action).toBeNull();
      expect(r.warnings[0]).toMatch(/no title/);
    });

    it('keeps the assignment but drops an impossible date', () => {
      // Losing the deliverable over a bad date is the worse failure.
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'add_assignment', title: 'Lab', due_date: '2026-02-30' } },
        known,
      );
      expect(r.action).toMatchObject({ title: 'Lab', due_date: null });
      expect(r.warnings[0]).toMatch(/unreadable/);
    });

    it('drops a time that has no date to attach to', () => {
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'add_assignment', title: 'Lab', due_time: '17:00' } },
        known,
      );
      expect(r.action).toMatchObject({ due_date: null, due_time: null });
      expect(r.warnings.some((w) => /no date/.test(w))).toBe(true);
    });
  });

  describe('actions that name a row', () => {
    it('accepts a checklist item that exists', () => {
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'complete_checklist_item', item_id: 'item-1' } },
        known,
      );
      expect(r.action).toEqual({ kind: 'complete_checklist_item', item_id: 'item-1' });
    });

    it('refuses a checklist item that does not', () => {
      // This is the one that matters: a fabricated id reaching a confirm
      // screen looks exactly as legitimate as a real one.
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'complete_checklist_item', item_id: 'made-up' } },
        known,
      );
      expect(r.action).toBeNull();
      expect(r.warnings[0]).toMatch(/not on your list/);
    });

    it('refuses a saved meal that does not exist', () => {
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'log_saved_meal', meal_id: 'nope' } },
        known,
      );
      expect(r.action).toBeNull();
    });

    it('rounds a portion to one the food screen can log', () => {
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'log_saved_meal', meal_id: 'meal-1', portion: 0.73 } },
        known,
      );
      expect(r.action).toMatchObject({ portion: 0.5 });
    });

    it('defaults a missing portion to one', () => {
      const r = validateChat(
        { reply: 'x', referenced: [], action: { kind: 'log_saved_meal', meal_id: 'meal-1' } },
        known,
      );
      expect(r.action).toMatchObject({ portion: 1 });
    });
  });

  describe('set_weight', () => {
    it('accepts a plausible weight', () => {
      const r = validateChat({ reply: 'x', referenced: [], action: { kind: 'set_weight', kg: 74.62 } }, known);
      expect(r.action).toEqual({ kind: 'set_weight', kg: 74.6 });
    });

    it('refuses an implausible one', () => {
      for (const kg of [0, -5, 900]) {
        const r = validateChat({ reply: 'x', referenced: [], action: { kind: 'set_weight', kg } }, known);
        expect(r.action).toBeNull();
      }
    });
  });

  it('refuses an action this app cannot do', () => {
    const r = validateChat({ reply: 'x', referenced: [], action: { kind: 'delete_everything' } }, known);
    expect(r.action).toBeNull();
    expect(r.warnings[0]).toMatch(/cannot do/);
  });

  it('survives a malformed response without throwing', () => {
    expect(validateChat(null, known).action).toBeNull();
    expect(validateChat({ reply: 'x', referenced: 'no' }, known).referenced).toEqual([]);
    expect(validateChat({ reply: 'x', action: 'no' }, known).action).toBeNull();
  });
});
