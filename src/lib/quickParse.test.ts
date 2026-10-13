import { describe, expect, it } from 'vitest';
import { readCapture, type ReadOptions } from './quickParse';

// Monday 12 October 2026, 14:00.
const o: ReadOptions = {
  today: '2026-10-12',
  nowTime: '14:00',
  courses: [
    { id: 'phys', code: 'PHYS 205', name: 'Waves and Optics' },
    { id: 'coen212', code: 'COEN 212', name: 'Digital Systems Design' },
    { id: 'coen231', code: 'COEN 231', name: 'Computer Organization' },
  ],
};
const read = (t: string, extra: Partial<ReadOptions> = {}) => readCapture(t, { ...o, ...extra });

describe('readCapture', () => {
  it('reads a title, a weekday, a time and a course', () => {
    expect(read('lab report thu 5pm phys')).toEqual({ title: 'Lab report', day: '2026-10-15', time: '17:00', course: o.courses[0], kind: 'work' });
  });

  it('drops the connectors that went with the date', () => {
    expect(read('problem set 4 due fri at 11:59pm')?.title).toBe('Problem set 4');
    expect(read('turn in lab report by tomorrow')?.title).toBe('Turn in lab report');
  });

  it('reads relative days, month days and ISO dates', () => {
    expect(read('reading tomorrow')?.day).toBe('2026-10-13');
    expect(read('essay in 3 days')?.day).toBe('2026-10-15');
    expect(read('project in a week')?.day).toBe('2026-10-19');
    expect(read('essay oct 20')?.day).toBe('2026-10-20');
    expect(read('essay 3rd nov')?.day).toBe('2026-11-03');
    expect(read('essay 2026-12-01')?.day).toBe('2026-12-01');
  });

  it('puts a month day already behind us in next year', () => {
    expect(read('renew permit jan 5')?.day).toBe('2027-01-05');
  });

  it('reads a weekday as its next occurrence, never today', () => {
    expect(read('quiz mon')?.day).toBe('2026-10-19');
    expect(read('quiz tue')?.day).toBe('2026-10-13');
  });

  it('reads a bare time as today, or tomorrow once it has passed', () => {
    expect(read('call TA 5pm')?.day).toBe('2026-10-12');
    expect(read('call TA 9am')?.day).toBe('2026-10-13');
    expect(read('submit at midnight tomorrow')?.time).toBe('23:59');
  });

  it('matches a course by code however it is written, or by subject when unique', () => {
    expect(read('lab tmr coen212')?.course?.id).toBe('coen212');
    expect(read('lab tmr COEN-231')?.course?.id).toBe('coen231');
    expect(read('lab tmr phys')?.course?.id).toBe('phys');
    // Two COEN courses: the subject alone names neither.
    expect(read('lab tmr coen')?.course).toBeNull();
  });

  it('turns exams and presentations into events', () => {
    expect(read('PHYS midterm oct 21 6pm')?.kind).toBe('exam');
    expect(read('group presentation fri')?.kind).toBe('presentation');
  });

  it('leaves a thought with no date as a thought', () => {
    expect(read('look into summer internships')).toBeNull();
    expect(read('phys reading')).toBeNull();
    // "sat" is a word before it is a day.
    expect(read('sat the quiz, felt fine')).toBeNull();
    expect(read('may need to email prof')).toBeNull();
  });

  it('reads short sat and sun as days only after a day word', () => {
    expect(read('laundry on sat')?.day).toBe('2026-10-17');
  });

  it('honours parts removed from the preview', () => {
    expect(read('lab report thu phys', { without: { course: true } })?.course).toBeNull();
    expect(read('lab report thu phys', { without: { date: true } })).toBeNull();
  });
});
