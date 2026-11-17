/**
 * A short visual lesson, made from notes the person pastes.
 *
 * The model never draws. It returns a lesson as data: a few steps, each a
 * sentence or two and at most one figure from a small vocabulary, and the app
 * draws the figure itself. That keeps every figure inside what the renderer
 * can draw correctly, and it means a bad figure is dropped by the validator
 * below rather than shown as a confident wrong picture. The step's words
 * survive a dropped figure, because losing the explanation is worse than
 * losing its illustration.
 *
 * Curves are given as expressions and evaluated here, never as points the
 * model computed: a model asked for y-values of sin(x) gets some of them
 * wrong, and a plotted curve looks equally sure of every point.
 */

export type Role = 'given' | 'new' | 'other';

export type PlotItem =
  | { kind: 'curve'; expr: string; label?: string; role: Role }
  | { kind: 'point'; x: number; y: number; label?: string; role: Role }
  | { kind: 'line'; from: [number, number]; to: [number, number]; label?: string; role: Role };

export type Figure =
  | { type: 'plot'; x: [number, number]; y: [number, number]; items: PlotItem[] }
  | { type: 'flow'; nodes: { id: string; label: string; role: Role }[]; edges: { from: string; to: string; label?: string }[] }
  | { type: 'steps'; lines: { text: string; status: 'given' | 'derived' | 'goal'; why?: string }[] }
  | { type: 'compare'; left: { title: string; points: string[] }; right: { title: string; points: string[] } };

export interface LessonStep {
  say: string;
  /** Where in the pasted notes this came from, in the notes' own words ("slide 12"). */
  source?: string;
  figure?: Figure;
}

export interface Lesson {
  title: string;
  steps: LessonStep[];
  check: { question: string; options: string[]; answer: number; why: string } | null;
}

/*
 * Gemini's response schema has no unions, so every figure field is optional
 * here and the validator decides which shape a figure actually is.
 */
const ROLE = { type: 'string', enum: ['given', 'new', 'other'] };
const PAIR = { type: 'array', items: { type: 'number' } };

export const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          say: { type: 'string' },
          source: { type: 'string' },
          figure: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['plot', 'flow', 'steps', 'compare', 'none'] },
              x: PAIR,
              y: PAIR,
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['curve', 'point', 'line'] },
                    expr: { type: 'string' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    from: PAIR,
                    to: PAIR,
                    label: { type: 'string' },
                    role: ROLE,
                  },
                  required: ['kind', 'role'],
                },
              },
              nodes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, label: { type: 'string' }, role: ROLE },
                  required: ['id', 'label', 'role'],
                },
              },
              edges: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
                  required: ['from', 'to'],
                },
              },
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    status: { type: 'string', enum: ['given', 'derived', 'goal'] },
                    why: { type: 'string' },
                  },
                  required: ['text', 'status'],
                },
              },
              left: {
                type: 'object',
                properties: { title: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
              },
              right: {
                type: 'object',
                properties: { title: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
              },
            },
            required: ['type'],
          },
        },
        required: ['say'],
      },
    },
    check: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        answer: { type: 'integer' },
        why: { type: 'string' },
      },
    },
  },
  required: ['title', 'steps'],
} as const;

export const LESSON_INSTRUCTION = [
  'You teach one idea from a student\'s course notes as a short lesson of three to six steps.',
  'Each step says one thing in one or two plain sentences, building on the step before.',
  'Give a step a figure only when a picture explains it better than words, and pick the figure type:',
  '"plot" for a function or a relationship between two quantities: give x and y ranges as [min, max],',
  'curves as an expression in x using + - * / ^ ( ) and sin cos tan exp ln log sqrt abs pi e,',
  'points as x and y, and lines as from and to pairs.',
  '"flow" for a process, a cause and effect, or parts of a system: up to eight nodes with short labels',
  'and edges between their ids.',
  '"steps" for a derivation or a worked method: up to eight lines, each marked given, derived or goal,',
  'with an optional short why.',
  '"compare" for two things students confuse: two titles with up to five short points each.',
  'Mark each figure element\'s role: "given" for what the step starts from, "new" for what this step adds,',
  '"other" for a second thing being contrasted. Reuse an element from the previous step as "given".',
  'Write maths as plain text a phone can show, like x^2 or dy/dx, never LaTeX.',
  'If the notes say where an idea comes from (a slide, page or section number), put it in source;',
  'otherwise leave source out. Never invent one.',
  'Use only what the notes say. Do not add facts, results or examples the notes do not support.',
  'End with one multiple-choice check question with three or four options, the index of the right one,',
  'and one sentence on why it is right.',
  'Return only the JSON.',
].join(' ');

/* -------------------------------------------------------------- expressions */

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

/**
 * Compiles an expression in x into a function, or returns null.
 *
 * A hand-written parser rather than `new Function`, because the expression
 * came from a model and is drawn in the person's browser: it may contain
 * numbers, x, pi, e, the operators and the functions above, and nothing else.
 */
export function compileExpr(src: string): ((x: number) => number) | null {
  const tokens = src.replace(/\s+/g, '').match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/^()]/gi);
  if (!tokens || tokens.join('') !== src.replace(/\s+/g, '')) return null;
  let i = 0;
  type Node = (x: number) => number;

  // expr := term (('+'|'-') term)*
  const expr = (): Node | null => {
    let left = term();
    while (left && (tokens[i] === '+' || tokens[i] === '-')) {
      const op = tokens[i++];
      const right = term();
      if (!right) return null;
      const l = left;
      left = op === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  };
  // term := unary (('*'|'/'|implicit) unary)*
  const term = (): Node | null => {
    let left = unary();
    while (left && i < tokens.length && tokens[i] !== '+' && tokens[i] !== '-' && tokens[i] !== ')') {
      const op = tokens[i] === '*' || tokens[i] === '/' ? tokens[i++] : '*'; // 2x, 3sin(x)
      const right = unary();
      if (!right) return null;
      const l = left;
      left = op === '/' ? (x) => l(x) / right(x) : (x) => l(x) * right(x);
    }
    return left;
  };
  // unary := '-' unary | power
  const unary = (): Node | null => {
    if (tokens[i] === '-') {
      i++;
      const v = unary();
      return v && ((x) => -v(x));
    }
    if (tokens[i] === '+') i++;
    return power();
  };
  // power := atom ('^' unary)?   (right-associative, and -x^2 is -(x^2))
  const power = (): Node | null => {
    const base = atom();
    if (!base || tokens[i] !== '^') return base;
    i++;
    const exp = unary();
    return exp && ((x) => Math.pow(base(x), exp(x)));
  };
  const atom = (): Node | null => {
    const t = tokens[i++];
    if (t === undefined) return null;
    if (/^[\d.]/.test(t)) {
      const n = Number(t);
      return Number.isFinite(n) ? () => n : null;
    }
    if (t === '(') {
      const inner = expr();
      return inner && tokens[i++] === ')' ? inner : null;
    }
    const name = t.toLowerCase();
    if (name === 'x') return (x) => x;
    if (name === 'pi') return () => Math.PI;
    if (name === 'e') return () => Math.E;
    // Own keys only: FUNCS['constructor'] would otherwise be Object.
    const f = Object.hasOwn(FUNCS, name) ? FUNCS[name] : undefined;
    if (f && tokens[i] === '(') {
      const arg = atom();
      return arg && ((x) => f(arg(x)));
    }
    return null;
  };

  const fn = expr();
  return fn && i === tokens.length ? fn : null;
}

/* --------------------------------------------------------------- validation */

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null ? [v[0], v[1]] : null;
const range = (v: unknown): [number, number] | null => {
  const p = pair(v);
  return p && p[0] < p[1] && p[1] - p[0] < 1e6 ? p : null;
};
const role = (v: unknown): Role => (v === 'new' || v === 'other' ? v : 'given');

function validateFigure(raw: unknown, warn: (m: string) => void): Figure | undefined {
  const f = raw as Record<string, unknown> | null;
  if (!f || typeof f !== 'object' || f.type === 'none' || f.type === undefined) return undefined;

  if (f.type === 'plot') {
    const x = range(f.x);
    const y = range(f.y);
    if (!x || !y) return warn('A graph came back without usable axes and was left out.'), undefined;
    const items: PlotItem[] = [];
    for (const it of Array.isArray(f.items) ? f.items.slice(0, 8) : []) {
      const r = it as Record<string, unknown>;
      const label = str(r.label, 30) ?? undefined;
      if (r.kind === 'curve') {
        const expr = str(r.expr, 120);
        const fn = expr ? compileExpr(expr) : null;
        // A curve that is undefined across the whole visible range draws nothing.
        const samples = fn ? Array.from({ length: 21 }, (_, k) => fn(x[0] + ((x[1] - x[0]) * k) / 20)) : [];
        if (!fn || !samples.some(Number.isFinite)) {
          warn(`A curve the app cannot draw was left out${expr ? `: ${expr}` : ''}.`);
          continue;
        }
        items.push({ kind: 'curve', expr: expr as string, label, role: role(r.role) });
      } else if (r.kind === 'point' && num(r.x) !== null && num(r.y) !== null) {
        items.push({ kind: 'point', x: r.x as number, y: r.y as number, label, role: role(r.role) });
      } else if (r.kind === 'line' && pair(r.from) && pair(r.to)) {
        items.push({ kind: 'line', from: pair(r.from)!, to: pair(r.to)!, label, role: role(r.role) });
      }
    }
    if (!items.length) return warn('A graph came back empty and was left out.'), undefined;
    return { type: 'plot', x, y, items };
  }

  if (f.type === 'flow') {
    const nodes: Extract<Figure, { type: 'flow' }>['nodes'] = [];
    const ids = new Set<string>();
    for (const n of Array.isArray(f.nodes) ? f.nodes.slice(0, 8) : []) {
      const r = n as Record<string, unknown>;
      const id = str(r.id, 40);
      const label = str(r.label, 40);
      if (!id || !label || ids.has(id)) continue;
      ids.add(id);
      nodes.push({ id, label, role: role(r.role) });
    }
    // An edge to a node that does not exist would point at nothing on screen.
    const edges = (Array.isArray(f.edges) ? f.edges : [])
      .map((e) => e as Record<string, unknown>)
      .filter((e) => ids.has(e.from as string) && ids.has(e.to as string) && e.from !== e.to)
      .slice(0, 12)
      .map((e) => ({ from: e.from as string, to: e.to as string, label: str(e.label, 24) ?? undefined }));
    if (nodes.length < 2) return warn('A diagram came back with too little in it and was left out.'), undefined;
    return { type: 'flow', nodes, edges };
  }

  if (f.type === 'steps') {
    const lines = (Array.isArray(f.lines) ? f.lines.slice(0, 8) : [])
      .map((l) => l as Record<string, unknown>)
      .map((l) => ({
        text: str(l.text, 160),
        status: (l.status === 'derived' || l.status === 'goal' ? l.status : 'given') as 'given' | 'derived' | 'goal',
        why: str(l.why, 160) ?? undefined,
      }))
      .filter((l): l is { text: string; status: 'given' | 'derived' | 'goal'; why: string | undefined } => l.text !== null);
    if (!lines.length) return warn('A worked method came back empty and was left out.'), undefined;
    return { type: 'steps', lines };
  }

  if (f.type === 'compare') {
    const side = (v: unknown) => {
      const s = v as Record<string, unknown> | null;
      const title = str(s?.title, 40);
      const points = (Array.isArray(s?.points) ? s.points : []).map((p) => str(p, 120)).filter((p): p is string => p !== null).slice(0, 5);
      return title && points.length ? { title, points } : null;
    };
    const left = side(f.left);
    const right = side(f.right);
    if (!left || !right) return warn('A comparison came back with a side missing and was left out.'), undefined;
    return { type: 'compare', left, right };
  }

  warn('A figure of a kind the app does not draw was left out.');
  return undefined;
}

export function validateLesson(raw: unknown): { lesson: Lesson; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => void warnings.push(m);
  const root = (raw ?? {}) as Record<string, unknown>;

  const steps: LessonStep[] = [];
  for (const s of Array.isArray(root.steps) ? root.steps : []) {
    const r = s as Record<string, unknown>;
    const say = str(r.say, 500);
    if (!say) continue;
    steps.push({ say, source: str(r.source, 60) ?? undefined, figure: validateFigure(r.figure, warn) });
  }
  if (steps.length > 6) {
    warnings.push(`${steps.length} steps came back; the first six were kept.`);
    steps.length = 6;
  }

  let check: Lesson['check'] = null;
  const c = root.check as Record<string, unknown> | undefined;
  if (c) {
    const question = str(c.question, 300);
    const options = (Array.isArray(c.options) ? c.options : []).map((o) => str(o, 160)).filter((o): o is string => o !== null);
    const answer = num(c.answer);
    // A check whose answer index points nowhere would mark every choice wrong.
    if (question && options.length >= 2 && options.length <= 4 && answer !== null && Number.isInteger(answer) && answer >= 0 && answer < options.length) {
      check = { question, options, answer, why: str(c.why, 300) ?? '' };
    } else {
      warnings.push('The check question came back malformed and was left out.');
    }
  }

  return { lesson: { title: str(root.title, 120) ?? 'Lesson', steps, check }, warnings };
}
