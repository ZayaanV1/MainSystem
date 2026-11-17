import { describe, expect, it } from 'vitest';
import { compileExpr, validateLesson } from '../../supabase/functions/_shared/lesson';

describe('compileExpr', () => {
  const at = (src: string, x: number) => compileExpr(src)?.(x);

  it('follows the usual precedence', () => {
    expect(at('1 + 2*x^2', 3)).toBe(19);
    expect(at('-x^2', 3)).toBe(-9);
    expect(at('2^3^2', 0)).toBe(512);
    expect(at('(x+1)/(x-1)', 3)).toBe(2);
  });

  it('reads implicit multiplication, functions and constants', () => {
    expect(at('2x', 4)).toBe(8);
    expect(at('3sin(pi/2)', 0)).toBeCloseTo(3);
    expect(at('ln(e^x)', 2)).toBeCloseTo(2);
    expect(at('sqrt(abs(x))', -16)).toBe(4);
  });

  it('refuses anything that is not maths', () => {
    expect(compileExpr('alert(1)')).toBeNull();
    expect(compileExpr('x; fetch()')).toBeNull();
    expect(compileExpr('constructor')).toBeNull();
    expect(compileExpr('constructor(x)')).toBeNull();
    expect(compileExpr('(x+1')).toBeNull();
    expect(compileExpr('x +')).toBeNull();
    expect(compileExpr('')).toBeNull();
  });
});

describe('validateLesson', () => {
  it('keeps the words of a step whose figure cannot be drawn', () => {
    const { lesson, warnings } = validateLesson({
      title: 'Slopes',
      steps: [{ say: 'A slope is rise over run.', figure: { type: 'plot', x: [0, 1], y: [0, 1], items: [{ kind: 'curve', expr: 'window.x', role: 'new' }] } }],
    });
    expect(lesson.steps).toHaveLength(1);
    expect(lesson.steps[0].figure).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/cannot draw/);
  });

  it('drops edges that point at nodes that do not exist', () => {
    const { lesson } = validateLesson({
      title: 't',
      steps: [
        {
          say: 's',
          figure: {
            type: 'flow',
            nodes: [{ id: 'a', label: 'A', role: 'given' }, { id: 'b', label: 'B', role: 'new' }],
            edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'ghost' }],
          },
        },
      ],
    });
    const fig = lesson.steps[0].figure;
    expect(fig?.type === 'flow' && fig.edges).toEqual([{ from: 'a', to: 'b', label: undefined }]);
  });

  it('leaves out a check whose answer points nowhere', () => {
    const { lesson, warnings } = validateLesson({
      title: 't',
      steps: [{ say: 's' }],
      check: { question: 'q?', options: ['a', 'b'], answer: 2, why: 'w' },
    });
    expect(lesson.check).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it('keeps six steps at most', () => {
    const { lesson } = validateLesson({ title: 't', steps: Array.from({ length: 9 }, (_, i) => ({ say: `s${i}` })) });
    expect(lesson.steps).toHaveLength(6);
  });
});
