import { describe, it, expect } from 'vitest';
import { courseGrades, gradeSummary, neededOnRest, neededSentence, withWhatIf } from './grades';
import type { Assignment } from './planner';

const work = (o: Partial<Assignment> & { id: string }): Assignment => ({
  course_id: null,
  title: o.id,
  due_at: null,
  due_has_time: false,
  effort_minutes: null,
  actual_minutes: null,
  status: 'todo',
  notes: null,
  start_by_override: null,
  remind_at: null,
  weight_percent: null,
  grade_percent: null,
  link: null,
  ...o,
});

describe('courseGrades', () => {
  it('says nothing when nothing carries a weight', () => {
    const g = courseGrades([work({ id: 'a' }), work({ id: 'b' })]);
    expect(g.empty).toBe(true);
    expect(gradeSummary(g)).toBeNull();
  });

  it('banks the share of the final grade an item has already decided', () => {
    // A 30%-weighted midterm scored at 80 has decided 24 points of the course.
    const g = courseGrades([work({ id: 'mid', weight_percent: 30, grade_percent: 80 })]);
    expect(g.earned).toBe(24);
    expect(g.weightMarked).toBe(30);
    expect(g.unmarked).toBe(0);
  });

  it('separates weight that exists from weight that is marked', () => {
    const g = courseGrades([
      work({ id: 'mid', weight_percent: 30, grade_percent: 80 }),
      work({ id: 'final', weight_percent: 50 }),
      work({ id: 'lab', weight_percent: 20 }),
    ]);
    expect(g.weightKnown).toBe(100);
    expect(g.weightMarked).toBe(30);
    expect(g.unmarked).toBe(2);
  });

  it('ignores unweighted work entirely rather than counting it as zero', () => {
    // Reading an unweighted item as 0% would drag a course's banked points
    // down for the crime of having a reading on the calendar.
    const g = courseGrades([
      work({ id: 'mid', weight_percent: 40, grade_percent: 90 }),
      work({ id: 'reading' }),
    ]);
    expect(g.weightKnown).toBe(40);
    expect(g.earned).toBe(36);
  });

  it('handles a zero score without treating it as absent', () => {
    // Scoring 0 is a real, recorded fact. Confusing it with "not marked yet"
    // would quietly restore marks a student did not get.
    const g = courseGrades([work({ id: 'quiz', weight_percent: 10, grade_percent: 0 })]);
    expect(g.weightMarked).toBe(10);
    expect(g.unmarked).toBe(0);
    expect(g.earned).toBe(0);
  });

  it('does not accumulate float error across a term', () => {
    // Weights are summed exactly. A course of eighths totalling 99.97 looks
    // like a data-entry error when it is an arithmetic one.
    const eighths = Array.from({ length: 8 }, (_, i) =>
      work({ id: `w${i}`, weight_percent: 12.5, grade_percent: 100 }),
    );
    const g = courseGrades(eighths);
    expect(g.weightKnown).toBe(100);
    expect(g.earned).toBe(100);
  });
});

describe('gradeSummary', () => {
  it('states what is on the calendar when none of it is marked', () => {
    const g = courseGrades([work({ id: 'f', weight_percent: 50 })]);
    expect(gradeSummary(g)).toBe('50% of the grade is on the calendar, none of it marked yet.');
  });

  it('reports banked points and what is left', () => {
    const g = courseGrades([
      work({ id: 'mid', weight_percent: 30, grade_percent: 80 }),
      work({ id: 'final', weight_percent: 50 }),
    ]);
    expect(gradeSummary(g)).toBe('24 of 30 points banked. 50% still to be marked, across 1 item.');
  });

  it('never derives a running average, which would be a score across time', () => {
    // 24/30 is 80%. Saying "averaging 80%" is real arithmetic and a verdict —
    // exactly the accumulating judgement rule 3 exists to prevent, and at its
    // most discouraging right after a single bad first assessment.
    const g = courseGrades([
      work({ id: 'mid', weight_percent: 30, grade_percent: 80 }),
      work({ id: 'final', weight_percent: 50 }),
    ]);
    const text = gradeSummary(g) ?? '';
    expect(text).not.toMatch(/averag|on track|predicted|projected|heading for/i);
    expect(text).not.toContain('80%');
  });

  it('says so plainly when everything is marked', () => {
    const g = courseGrades([work({ id: 'only', weight_percent: 100, grade_percent: 71 })]);
    expect(gradeSummary(g)).toBe('71 of 100 points banked. Everything on the calendar is marked.');
  });
});

describe('exams and presentations', () => {
  it('count toward the course alongside assignments', () => {
    const g = courseGrades([
      { weight_percent: 30, grade_percent: 80 },
      { weight_percent: 30, grade_percent: null }, // the midterm, an event
      { weight_percent: 40, grade_percent: null }, // the final, an event
    ]);
    expect(g.weightKnown).toBe(100);
    expect(g.weightMarked).toBe(30);
    expect(g.earned).toBe(24);
    expect(g.unmarked).toBe(2);
  });

  it('records a mark of zero as a mark', () => {
    const g = courseGrades([{ weight_percent: 10, grade_percent: 0 }]);
    expect(g.weightMarked).toBe(10);
    expect(g.unmarked).toBe(0);
  });
});

describe('neededOnRest', () => {
  // A 30% midterm at 80 banks 24; 70% of the course is still to come.
  const g = courseGrades([
    { weight_percent: 30, grade_percent: 80 },
    { weight_percent: 20, grade_percent: null },
  ]);

  it('works out the average the rest would need', () => {
    expect(neededOnRest(g, 80)).toEqual({ kind: 'needs', average: 80, remaining: 70 });
    expect(neededOnRest(g, 59)).toEqual({ kind: 'needs', average: 50, remaining: 70 });
  });

  it('counts weight no syllabus has named as still to come', () => {
    // Only 50% is known, but the remaining share is 100 - 30 marked.
    expect(neededOnRest(g, 94).kind).toBe('needs');
  });

  it('says when the target is already banked', () => {
    expect(neededOnRest(g, 20)).toEqual({ kind: 'already', earned: 24 });
  });

  it('says plainly when the rest cannot give it', () => {
    expect(neededOnRest(g, 99)).toEqual({ kind: 'beyond', average: 107.1, remaining: 70 });
    expect(neededSentence(neededOnRest(g, 99), 99)).toBe('99 would take 107.1 on the remaining 70%, more than the rest can give.');
  });

  it('knows when everything is marked', () => {
    const all = courseGrades([{ weight_percent: 100, grade_percent: 71 }]);
    expect(neededOnRest(all, 80)).toEqual({ kind: 'all-marked', earned: 71 });
  });
});

describe('withWhatIf', () => {
  const items = [
    { id: 'a', weight_percent: 30, grade_percent: 80 },
    { id: 'b', weight_percent: 20, grade_percent: null },
  ];

  it('fills unmarked items with a hypothetical mark, without touching real ones', () => {
    const g = withWhatIf(items, { a: 10, b: 90 });
    expect(g.earned).toBe(42);
    expect(g.weightMarked).toBe(50);
    expect(items[1].grade_percent).toBeNull();
  });
});
