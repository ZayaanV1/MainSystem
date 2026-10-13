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
    expect(read('lab report thu 5pm phys')).toEqual({ title: 'Lab report', day: '2026-10-15', time: '17:00', course: o.courses[0], kind: 'work', original: 'lab report thu 5pm phys' });
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

  it('reads "this" with today\'s weekday as today', () => {
    expect(read('this mon quiz')?.day).toBe('2026-10-12');
    expect(read('mon quiz')?.day).toBe('2026-10-19');
  });

  it('reads a bare clock time only beside a day or after a time word', () => {
    expect(read('lab 14:30 thu')).toMatchObject({ day: '2026-10-15', time: '14:30' });
    expect(read('meet TA at 16:00')).toMatchObject({ day: '2026-10-12', time: '16:00' });
    expect(read('read john 3:16')).toBeNull();
    expect(read('mix the buffer 1:20')).toBeNull();
  });

  it('keeps what was typed whenever the title is only part of it', () => {
    expect(read('lab report thu 5pm phys')?.original).toBe('lab report thu 5pm phys');
  });

  it('keeps work about an exam as work', () => {
    expect(read('study for midterm thu')?.kind).toBe('work');
    expect(read('midterm review session fri 3pm')?.kind).toBe('work');
    expect(read('practice exam questions tomorrow')?.kind).toBe('work');
    expect(read('final exam prep tomorrow')?.kind).toBe('work');
    expect(read('book room for presentation practice wed')?.kind).toBe('work');
    expect(read('presentation slides due fri')?.kind).toBe('work');
  });

  /*
   * The guard for the class, not the instances. Every line here is something a
   * student types into capture in a hurry, and each one used to come back as
   * dated work, because any word that began like a month was read as one.
   * None of them names a day.
   */
  it.each([
    'mark 3 problems from ch 4',
    'read novel 2 chapters',
    'decide 3 topics for essay',
    'finish 2 marking sheets',
    'augment 5 figures in report',
    'janet 4 notes to return',
    'marks 2 and 3 look off',
    'decimal 2 places on lab',
    'octave 3 in the pitch lab',
    'maybe 2 more sources',
    'junior 3 seminar reading',
    'julia 3 notebook cleanup',
    'separate 4 samples',
    'apricot 2 photos',
    'febrile 3 case notes',
    'noval 5 draft',
    'novice 2 problems',
    'marginal 3 cost question',
    'sepia 2 prints',
    'jane 3 slides',
    'auger 2 holes for project',
    'decay 3 constant',
    'octet 4 rule summary',
    'read john 3:16',
    'ratio 1:20 for the buffer',
    'page 12:30 of the transcript',
    'email prof about grade',
    'may need to email prof',
    'look into summer internships',
    'sat the quiz, felt fine',
    'sun exposure lab notes',
    'chapters 3 and 4',
    'buy 2 notebooks',
    'q 4 of problem set',
    'room 2 of 3',
  ])('leaves %s as a thought', (thought) => {
    expect(read(thought)).toBeNull();
  });

  /* And the same class from the other side: what must still read as a date. */
  it.each([
    ['essay mar 3', '2027-03-03'],
    ['essay march 3', '2027-03-03'],
    ['essay mar. 3', '2027-03-03'],
    ['essay 3 march', '2027-03-03'],
    ['report nov 2', '2026-11-02'],
    ['report november 2nd', '2026-11-02'],
    ['report 2nd nov', '2026-11-02'],
    ['lab dec 3', '2026-12-03'],
    ['quiz sept 9', '2027-09-09'],
    ['quiz sep 9', '2027-09-09'],
    ['essay jan 15', '2027-01-15'],
    ['essay oct 20', '2026-10-20'],
  ])('reads %s as %s', (text, day) => {
    expect(read(text)?.day).toBe(day);
  });

  it('honours parts removed from the preview', () => {
    expect(read('lab report thu phys', { without: { course: true } })?.course).toBeNull();
    expect(read('lab report thu phys', { without: { date: true } })).toBeNull();
  });
});
