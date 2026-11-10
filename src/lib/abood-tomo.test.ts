import { describe, it, expect } from 'vitest';
import { scripted } from '../../supabase/functions/_shared/chat';
import { checkinSignal, freeWindow } from '../../supabase/functions/_shared/signals';

/**
 * The parts of Abood taken from the Tomo teardown (replica/tomo.md): no
 * assistant-script openers, no repeated openers, dated memory, and check-ins
 * that come from what is happening in the day.
 */

const TZ = 'America/Toronto';
const at = (hhmm: string, day = '2026-11-10') => new Date(`${day}T${hhmm}:00-05:00`);

describe('the assistant script', () => {
  it('flags a congratulation opener and a feelings check', () => {
    expect(scripted("congrats!! that's a big milestone.").join()).toMatch(/congratulation/);
    expect(scripted("That's amazing! A 10k takes real dedication.").join()).toMatch(/congratulation/);
    expect(scripted('first 10k. how did it feel').join()).toMatch(/how did it feel/);
  });

  it('passes the replies Tomo chose', () => {
    expect(scripted('FIRST 10K?? so proud of you')).toEqual([]);
    expect(scripted('wait how long have you been training for this?? i need details')).toEqual([]);
  });

  it('flags a reply that opens the way an earlier one did', () => {
    const earlier = ['your walmart order got delivered, email says instacart dropped it off'];
    expect(scripted('your walmart order came in, doordash this time', earlier).join()).toMatch(/same words/);
    expect(scripted('yo, how was the gym', earlier)).toEqual([]);
  });
});

describe('dated memory', () => {
  it('leads a fact with the day it was told, in their zone', async () => {
    const { datedFact } = await import('../../supabase/functions/_shared/abood');
    // 03:30 UTC on Monday 12 Oct is still Sunday evening in Toronto.
    expect(datedFact('Stayed up talking about French class.', '2026-10-12T03:30:00Z', TZ)).toBe(
      'Sun, Oct 11: Stayed up talking about French class.',
    );
    expect(datedFact('No date.', '', TZ)).toBe('No date.');
  });

  it('never stores a date a model copied into a new fact', async () => {
    const { validateFacts } = await import('../../supabase/functions/_shared/abood');
    expect(validateFacts({ facts: ['Sat, Oct 11: Ran a first 10k.'] }, [])).toEqual(['Ran a first 10k.']);
  });
});

describe('check-in signals', () => {
  const gym = { title: 'Gym', start: at('15:30'), end: at('17:30') };
  const math = { title: 'MATH 205 study', start: at('17:30'), end: at('20:30') };
  const dues = [
    { title: 'MATH 205 assignment 7', due: at('23:59') },
    { title: 'COEN 212 assignment 4', due: at('23:59') },
  ];

  it('finds the free stretch before tonight, around the blocks', () => {
    const w = freeWindow(at('14:31'), [gym, math], dues[0].due);
    expect(w?.start).toEqual(at('14:31'));
    expect(w?.end).toEqual(at('15:30'));
    // Nothing free until after the study block.
    expect(freeWindow(at('15:00'), [gym, math], dues[0].due)?.start).toEqual(at('20:30'));
  });

  it('names two things due tonight and the window, with real times', () => {
    const s = checkinSignal(at('14:31'), [gym, math], dues, TZ);
    expect(s).toMatch(/MATH 205 assignment 7 \(11:59/);
    expect(s).toMatch(/free stretch is 2:31.* to 3:30/);
  });

  it('says what has just started when nothing is due', () => {
    expect(checkinSignal(at('15:40'), [gym], [], TZ)).toMatch(/right now they are at: Gym/);
    // An hour in is not "just started".
    expect(checkinSignal(at('16:40'), [gym], [], TZ)).toBeNull();
  });

  it('stays quiet for one thing due, or a day with no room', () => {
    expect(checkinSignal(at('10:00'), [], [dues[0]], TZ)).toBeNull();
    const busy = [{ title: 'Lab', start: at('10:00'), end: at('23:59') }];
    expect(checkinSignal(at('10:20'), busy, dues, TZ)).toMatch(/right now they are at: Lab/);
  });
});
