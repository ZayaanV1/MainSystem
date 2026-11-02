import { describe, expect, it } from 'vitest';
import { CONNECTOR_TOOLS, dueInstant, resolveCourse } from '../../supabase/functions/_shared/connector';
import { ToolError } from '../../supabase/functions/_shared/mcp';

const courses = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Electromagnetism', code: 'PHYS 2020', archived: false },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Circuits', code: 'COEN 212', archived: false },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Circuits lab', code: 'COEN 231', archived: false },
];

describe('resolveCourse', () => {
  it('takes an id, a code or a name, in any case', () => {
    expect(resolveCourse(courses, courses[0].id)).toBe(courses[0].id);
    expect(resolveCourse(courses, 'coen 212')).toBe(courses[1].id);
    expect(resolveCourse(courses, 'electromagnetism')).toBe(courses[0].id);
    expect(resolveCourse(courses, 'phys')).toBe(courses[0].id);
    expect(resolveCourse(courses, null)).toBeNull();
  });

  it('prefers an exact name over a looser match', () => {
    expect(resolveCourse(courses, 'Circuits')).toBe(courses[1].id);
  });

  it('tells the model the choices when it is ambiguous or unknown', () => {
    expect(() => resolveCourse(courses, 'coen')).toThrow(/more than one course \(COEN 212, COEN 231\)/);
    expect(() => resolveCourse(courses, 'CHEM 101')).toThrow(ToolError);
    expect(() => resolveCourse(courses, 'CHEM 101')).toThrow(/PHYS 2020, COEN 212, COEN 231/);
  });
});

describe('dueInstant', () => {
  it('is the end of the day without a time, in the account zone', () => {
    // Regina is UTC-6 all year.
    expect(dueInstant('2026-11-05', null, 'America/Regina')).toBe('2026-11-06T05:59:00.000Z');
  });

  it('is the stated wall-clock time with one', () => {
    expect(dueInstant('2026-11-05', '09:30', 'America/Regina')).toBe('2026-11-05T15:30:00.000Z');
  });
});

describe('the connector tools', () => {
  it('offer no way to delete anything', () => {
    expect(CONNECTOR_TOOLS.some((t) => /delete|remove|clear/i.test(t.name))).toBe(false);
  });

  it('mark exactly the reading tools read-only', () => {
    expect(CONNECTOR_TOOLS.filter((t) => t.readOnly).map((t) => t.name)).toEqual([
      'get_today',
      'list_work',
      'list_schedule',
      'search',
      'list_courses',
    ]);
  });
});
