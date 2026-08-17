import { describe, it, expect } from 'vitest';
import { dueTimestamp, parseBulk, parseLine, summarise, type CourseRef } from './bulk';

/**
 * The bulk importer's job is to make a semester's deadlines enterable in one
 * paste. Its other job — equally important — is to be honest about what it
 * guessed, because nothing here reaches the database without the parse being
 * shown first, and a preview you cannot trust is worse than typing it all in.
 */

const TODAY = '2026-08-17'; // Monday

const COURSES: CourseRef[] = [
  { id: 'c1', name: 'Organic Chemistry', code: 'CHEM 233' },
  { id: 'c2', name: 'Linear Algebra', code: 'MATH 133' },
];

const one = (line: string, today = TODAY) => parseLine(line, COURSES, today);

describe('the shapes a syllabus actually comes in', () => {
  it('reads "title, month day"', () => {
    const r = one('Lab report, Sept 12');
    expect(r).toMatchObject({ title: 'Lab report', dueDay: '2026-09-12', kind: 'assignment' });
  });

  it('reads an em-dash separator', () => {
    expect(one('Essay draft — Sep 20').dueDay).toBe('2026-09-20');
  });

  it('reads a hyphen separator', () => {
    expect(one('Essay draft - Sep 20').title).toBe('Essay draft');
  });

  it('reads an ISO date', () => {
    const r = one('Problem set 4, 2026-09-25');
    expect(r.dueDay).toBe('2026-09-25');
    expect(r.warnings).not.toContain('year assumed 2026');
  });

  it('reads day-first dates', () => {
    expect(one('Reading response, 12 September').dueDay).toBe('2026-09-12');
  });

  it('reads an ordinal', () => {
    expect(one('Draft, Sept 12th').dueDay).toBe('2026-09-12');
  });

  it('reads an explicit year', () => {
    expect(one('Thesis, March 3 2027').dueDay).toBe('2027-03-03');
  });

  it('reads a date embedded in prose', () => {
    const r = one('Essay draft due Sep 20 at 5pm');
    expect(r).toMatchObject({ title: 'Essay draft', dueDay: '2026-09-20', dueTime: '17:00' });
  });

  it('survives a bullet character', () => {
    expect(parseBulk('• Lab report, Sept 12', COURSES, TODAY)[0].dueDay).toBe('2026-09-12');
  });
});

describe('year inference — a syllabus read in August spans into next year', () => {
  it('keeps this year for a date still ahead', () => {
    expect(one('Quiz, Sept 12').dueDay).toBe('2026-09-12');
  });

  it('rolls into next year for a month that has already passed', () => {
    // Pasting a fall syllabus in August: "Jan 15" is next January, not one
    // seven months gone.
    expect(one('Final report, Jan 15').dueDay).toBe('2027-01-15');
  });

  it('says out loud that it assumed a year', () => {
    expect(one('Final report, Jan 15').warnings).toContain('year assumed 2027');
  });

  it('does not assume when the year was given', () => {
    expect(one('Final report, Jan 15 2026').warnings.join(' ')).not.toMatch(/year assumed/);
  });
});

describe('times', () => {
  it('reads 11:59pm', () => {
    expect(one('Essay, Sep 20, 11:59pm').dueTime).toBe('23:59');
  });

  it('reads a 24-hour time', () => {
    expect(one('Essay, Sep 20, 17:00').dueTime).toBe('17:00');
  });

  it('reads midnight and noon correctly', () => {
    expect(one('A, Sep 20, 12am').dueTime).toBe('00:00');
    expect(one('B, Sep 20, 12pm').dueTime).toBe('12:00');
  });

  it('leaves the time null when none is given', () => {
    expect(one('Essay, Sep 20').dueTime).toBeNull();
  });
});

describe('effort estimates', () => {
  it('reads hours', () => {
    expect(one('Essay, Sep 20, 3h').effortMinutes).toBe(180);
  });

  it('reads fractional hours', () => {
    expect(one('Essay, Sep 20, 1.5h').effortMinutes).toBe(90);
  });

  it('reads minutes', () => {
    expect(one('Reading, Sep 20, 45m').effortMinutes).toBe(45);
  });

  it('reads spelled-out units', () => {
    expect(one('Essay, Sep 20, 2 hours').effortMinutes).toBe(120);
  });
});

describe('courses', () => {
  it('matches a course code prefix', () => {
    const r = one('CHEM 233: Lab report, Sept 12');
    expect(r.courseId).toBe('c1');
    expect(r.title).toBe('Lab report');
  });

  it('matches a course named as its own fragment', () => {
    expect(one('Problem set, MATH 133, Oct 2').courseId).toBe('c2');
  });

  it('matches a full course name', () => {
    expect(one('Essay, Organic Chemistry, Oct 2').courseId).toBe('c1');
  });

  it('says when no course matched rather than picking one', () => {
    const r = one('Dentist appointment, Sep 3');
    expect(r.courseId).toBeNull();
    expect(r.warnings).toContain('no course matched');
  });

  it('does not mistake a colon inside a title for a course prefix', () => {
    const r = one('Reading: chapters 4-6, Sep 9');
    expect(r.courseId).toBeNull();
    expect(r.title).toContain('Reading');
  });
});

describe('assignments versus events', () => {
  it('reads an exam as an event', () => {
    const r = one('Midterm exam, Oct 15');
    expect(r).toMatchObject({ kind: 'event', eventKind: 'exam' });
  });

  it('reads a lab session as an event', () => {
    expect(one('Lab 3, Sep 18').eventKind).toBe('lab');
  });

  it('does NOT read a lab report as an event', () => {
    // A syllabus is full of "lab report", "lab write-up", "exam prep". Those
    // are work you do, not sessions you attend, and events cannot be ticked
    // off — so misfiling them loses the work.
    for (const t of [
      'Lab report, Sept 12',
      'Lab write-up, Sept 12',
      'Lab notebook, Sept 12',
      'Exam prep, Oct 10',
      'Presentation slides, Nov 1',
      'Midterm review questions, Oct 8',
    ]) {
      expect(one(t).kind, t).toBe('assignment');
    }
  });

  it('reads a presentation as an event', () => {
    expect(one('Group presentation, Nov 4').eventKind).toBe('presentation');
  });

  it('says why it decided that, so the guess is visible', () => {
    expect(one('Final exam, Dec 10').warnings.join(' ')).toMatch(/read as exam because of/i);
  });

  it('leaves ordinary work as an assignment', () => {
    expect(one('Essay draft, Sep 20').kind).toBe('assignment');
  });
});

describe('being honest about what it could not read', () => {
  it('flags a missing date rather than inventing one', () => {
    const r = one('Read the whole book');
    expect(r.dueDay).toBeNull();
    expect(r.warnings).toContain('no date found');
    expect(r.usable).toBe(true);
  });

  it('flags an ambiguous slash date', () => {
    const r = one('Essay, 9/10');
    expect(r.dueDay).toBe('2026-09-10');
    expect(r.warnings).toContain('read 9/10 as month/day');
  });

  it('does not flag an unambiguous slash date', () => {
    const r = one('Essay, 9/25');
    expect(r.dueDay).toBe('2026-09-25');
    expect(r.warnings.join(' ')).not.toMatch(/month\/day/);
  });

  it('marks a line with no title unusable instead of guessing', () => {
    expect(one('Sept 12').usable).toBe(false);
  });

  it('never throws on nonsense', () => {
    for (const junk of ['...', '???', '   ', '2026-13-45', ',,,,', '🙂']) {
      expect(() => parseLine(junk, COURSES, TODAY)).not.toThrow();
    }
  });
});

describe('parseBulk', () => {
  const paste = `
CHEM 233: Lab report, Sept 12, 3h
Essay draft — Sep 20 at 11:59pm
MATH 133: Problem set 4, 2026-09-25
Midterm exam, Oct 15
Read the whole book
  `;

  it('parses every usable line', () => {
    const rows = parseBulk(paste, COURSES, TODAY);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.usable)).toBe(true);
  });

  it('gets the details right across the whole paste', () => {
    const rows = parseBulk(paste, COURSES, TODAY);
    expect(rows[0]).toMatchObject({
      title: 'Lab report',
      courseId: 'c1',
      dueDay: '2026-09-12',
      effortMinutes: 180,
    });
    expect(rows[1]).toMatchObject({ title: 'Essay draft', dueDay: '2026-09-20', dueTime: '23:59' });
    expect(rows[2]).toMatchObject({ courseId: 'c2', dueDay: '2026-09-25' });
    expect(rows[3]).toMatchObject({ kind: 'event', eventKind: 'exam' });
    expect(rows[4].dueDay).toBeNull();
  });

  it('drops blank lines', () => {
    expect(parseBulk('\n\n  \nEssay, Sep 20\n\n', COURSES, TODAY)).toHaveLength(1);
  });

  it('summarises what is about to be added', () => {
    expect(summarise(parseBulk(paste, COURSES, TODAY))).toBe(
      '4 assignments and 1 event, 1 without a date.',
    );
  });

  it('says plainly when there is nothing to add', () => {
    expect(summarise([])).toBe('Nothing to add.');
  });
});

describe('dueTimestamp', () => {
  it('stores an undated row as null', () => {
    expect(dueTimestamp(one('Read the book'))).toBeNull();
  });

  it('defaults a dateless time to the END of the day, not the start', () => {
    // Storing midnight would make "due Friday" look overdue for all of Friday.
    expect(dueTimestamp(one('Essay, Sep 20'))).toBe('2026-09-21T03:59:00.000Z'); // 23:59 EDT
  });

  it('honours an explicit time', () => {
    expect(dueTimestamp(one('Essay, Sep 20, 5pm'))).toBe('2026-09-20T21:00:00.000Z');
  });

  it('is correct on the far side of the fall-back', () => {
    // 20 Nov is EST, so 23:59 local is 04:59Z the next day.
    expect(dueTimestamp(one('Essay, Nov 20'))).toBe('2026-11-21T04:59:00.000Z');
  });
});
