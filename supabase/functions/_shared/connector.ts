import { int, str, day, time, bool, uuid, ToolError, type ToolDef } from './mcp.ts';
import { addDays, endOfDayUTC, formatTime, localDayKey, localHourMinute, startOfDayUTC, wallClockToUTC, type DayKey } from './time.ts';

/**
 * What an AI app signed in to the planner can do (functions/mcp, Nov 2026).
 *
 * Read the day, the work, the schedule, the courses; add work, events and
 * inbox thoughts; finish or reopen work; move a due date. Approved as
 * "saved right away, easy to undo": the AI app's allow prompt is the
 * confirmation, and every write is recorded in connector_changes with what
 * the row was before, so Settings can take it back (rule 6, kept by
 * reversibility rather than by a second prompt).
 *
 * Deliberately absent:
 *   - Deleting anything. The one action Undo cannot cover.
 *   - Abood's conversations and memory. That is the account's confidant, and
 *     handing it to another AI is not what it was built for.
 *   - The focus timer. It lives on the device (lib/focus.ts), on purpose.
 *   - Editing events mirrored from a subscribed calendar: the next sync would
 *     overwrite them, and they are not the account's to change here.
 *
 * Every query runs with the account's own token, so RLS bounds it exactly as
 * it bounds the app. The user_id filters below are belt and braces.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export interface ConnectorCtx {
  db: Db;
  userId: string;
  clientId: string | null;
  tz: string;
  now: Date;
}

const EVENT_KINDS = ['exam', 'lab', 'presentation', 'other'] as const;

/* ---- shaping what the model reads ---------------------------------------- */

interface CourseRow {
  id: string;
  name: string;
  code: string | null;
  archived: boolean;
}

function when(iso: string | null, hasTime: boolean, tz: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return hasTime ? `${localDayKey(at, tz)} ${formatTime(at, tz)}` : localDayKey(at, tz);
}

function courseLabel(courses: CourseRow[], id: string | null): string | null {
  const c = courses.find((x) => x.id === id);
  return c ? (c.code ?? c.name) : null;
}

// deno-lint-ignore no-explicit-any
function workOut(a: any, courses: CourseRow[], tz: string) {
  return {
    id: a.id,
    title: a.title,
    course: courseLabel(courses, a.course_id),
    due: when(a.due_at, a.due_has_time, tz),
    status: a.status,
    ...(a.effort_minutes ? { estimate_minutes: a.effort_minutes } : {}),
    ...(a.grade_percent !== null && a.grade_percent !== undefined ? { grade_percent: a.grade_percent } : {}),
  };
}

// deno-lint-ignore no-explicit-any
function eventOut(e: any, courses: CourseRow[], tz: string) {
  const start = new Date(e.starts_at);
  return {
    id: e.id,
    title: e.title,
    kind: e.kind,
    course: courseLabel(courses, e.course_id),
    day: localDayKey(start, tz),
    time: e.all_day ? 'all day' : `${formatTime(start, tz)}${e.ends_at ? ` – ${formatTime(new Date(e.ends_at), tz)}` : ''}`,
    ...(e.location ? { location: e.location } : {}),
    ...(e.feed_id ? { from_subscribed_calendar: true } : {}),
  };
}

const json = (v: unknown) => JSON.stringify(v, null, 1);

// deno-lint-ignore no-explicit-any
async function must(q: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

async function loadCourses(ctx: ConnectorCtx, withArchived = false): Promise<CourseRow[]> {
  let q = ctx.db.from('courses').select('id, name, code, archived').eq('user_id', ctx.userId).order('name');
  if (!withArchived) q = q.eq('archived', false);
  return (await must(q)) ?? [];
}

/** A course named by id, code or name. Ambiguity and absence are told to the model with the choices. */
export function resolveCourse(courses: CourseRow[], ref: string | null): string | null {
  if (!ref) return null;
  const r = ref.trim().toLowerCase();
  const byId = courses.find((c) => c.id === r);
  if (byId) return byId.id;
  const exact = courses.filter((c) => (c.code ?? '').toLowerCase() === r || c.name.toLowerCase() === r);
  if (exact.length === 1) return exact[0].id;
  const loose = exact.length ? exact : courses.filter((c) => `${c.code ?? ''} ${c.name}`.toLowerCase().includes(r));
  if (loose.length === 1) return loose[0].id;
  const names = courses.map((c) => c.code ?? c.name).join(', ') || 'none yet';
  throw new ToolError(
    loose.length ? `"${ref}" matches more than one course (${loose.map((c) => c.code ?? c.name).join(', ')}). Say which.` : `No course called "${ref}". The courses are: ${names}.`,
  );
}

/** Due instant: a stated time in the account's zone, or the end of the day (the app's rule). */
export function dueInstant(dayKey: DayKey, hhmm: string | null, tz: string): string {
  const [h, m] = hhmm ? hhmm.split(':').map(Number) : [23, 59];
  return wallClockToUTC(dayKey, h, m, 0, tz).toISOString();
}

async function record(ctx: ConnectorCtx, tool: string, table: string, id: string, before: unknown, summary: string) {
  const { error } = await ctx.db.from('connector_changes').insert({
    user_id: ctx.userId,
    client_id: ctx.clientId,
    tool,
    target_table: table,
    target_id: id,
    before,
    summary: summary.slice(0, 300),
  });
  return error;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ---- the tools ----------------------------------------------------------- */

export const CONNECTOR_TOOLS: ToolDef<ConnectorCtx>[] = [
  {
    name: 'get_today',
    description:
      "The user's day: open work due today or already late, today's remaining events, and how many thoughts are waiting in the inbox. Start here for anything about today.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    async run(_args, ctx) {
      const today = localDayKey(ctx.now, ctx.tz);
      const [courses, work, events, inbox] = await Promise.all([
        loadCourses(ctx, true),
        must(
          ctx.db
            .from('assignments')
            .select('id, title, course_id, due_at, due_has_time, status, effort_minutes, grade_percent')
            .eq('user_id', ctx.userId)
            .neq('status', 'done')
            .lt('due_at', endOfDayUTC(today, ctx.tz).toISOString())
            .order('due_at'),
        ),
        must(
          ctx.db
            .from('events')
            .select('id, title, kind, course_id, starts_at, ends_at, all_day, location, feed_id')
            .eq('user_id', ctx.userId)
            .gte('starts_at', startOfDayUTC(today, ctx.tz).toISOString())
            .lt('starts_at', endOfDayUTC(today, ctx.tz).toISOString())
            .order('starts_at'),
        ),
        must(ctx.db.from('inbox_items').select('id').eq('user_id', ctx.userId).is('triaged_at', null).is('dismissed_at', null)),
      ]);
      const late = (work ?? []).filter((a: { due_at: string }) => new Date(a.due_at) < ctx.now);
      const dueToday = (work ?? []).filter((a: { due_at: string }) => new Date(a.due_at) >= ctx.now);
      return json({
        today,
        timezone: ctx.tz,
        now: formatTime(ctx.now, ctx.tz),
        late: late.map((a: unknown) => workOut(a, courses, ctx.tz)),
        due_today: dueToday.map((a: unknown) => workOut(a, courses, ctx.tz)),
        events_today: (events ?? [])
          .filter((e: { all_day: boolean; ends_at: string | null; starts_at: string }) => e.all_day || new Date(e.ends_at ?? e.starts_at) > ctx.now)
          .map((e: unknown) => eventOut(e, courses, ctx.tz)),
        inbox_waiting: (inbox ?? []).length,
      });
    },
  },
  {
    name: 'list_work',
    description:
      'Assignments and other work. Defaults to open work, soonest due first, undated last. Filter by course (code or name), by status, or by a due-date range (YYYY-MM-DD, inclusive, in the user\'s time zone).',
    inputSchema: {
      type: 'object',
      properties: {
        course: { type: 'string', description: 'Course code, name or id' },
        status: { type: 'string', enum: ['open', 'done', 'all'] },
        due_from: { type: 'string', description: 'YYYY-MM-DD' },
        due_to: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    async run(args, ctx) {
      const courses = await loadCourses(ctx, true);
      const courseId = resolveCourse(courses, str(args, 'course', { max: 120 }));
      const status = str(args, 'status', { max: 4 }) ?? 'open';
      if (!['open', 'done', 'all'].includes(status)) throw new ToolError('"status" must be open, done or all.');
      const from = day(args, 'due_from');
      const to = day(args, 'due_to');
      let q = ctx.db
        .from('assignments')
        .select('id, title, course_id, due_at, due_has_time, status, effort_minutes, grade_percent')
        .eq('user_id', ctx.userId)
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(int(args, 'limit', 1, 100) ?? 40);
      if (courseId) q = q.eq('course_id', courseId);
      if (status === 'open') q = q.neq('status', 'done');
      if (status === 'done') q = q.eq('status', 'done');
      if (from) q = q.gte('due_at', startOfDayUTC(from, ctx.tz).toISOString());
      if (to) q = q.lt('due_at', endOfDayUTC(to, ctx.tz).toISOString());
      const rows = (await must(q)) ?? [];
      return json(rows.map((a: unknown) => workOut(a, courses, ctx.tz)));
    },
  },
  {
    name: 'list_schedule',
    description:
      "Events (classes, exams, labs, imported calendar events) and work due between two dates, inclusive, in the user's time zone. At most 62 days at once.",
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    readOnly: true,
    async run(args, ctx) {
      const from = day(args, 'from', true) as string;
      const to = day(args, 'to', true) as string;
      if (to < from) throw new ToolError('"to" is before "from".');
      if (to > addDays(from, 61)) throw new ToolError('Ask for 62 days or fewer at a time.');
      const start = startOfDayUTC(from, ctx.tz).toISOString();
      const end = endOfDayUTC(to, ctx.tz).toISOString();
      const [courses, events, work] = await Promise.all([
        loadCourses(ctx, true),
        must(
          ctx.db
            .from('events')
            .select('id, title, kind, course_id, starts_at, ends_at, all_day, location, feed_id')
            .eq('user_id', ctx.userId)
            .gte('starts_at', start)
            .lt('starts_at', end)
            .order('starts_at')
            .limit(300),
        ),
        must(
          ctx.db
            .from('assignments')
            .select('id, title, course_id, due_at, due_has_time, status, effort_minutes, grade_percent')
            .eq('user_id', ctx.userId)
            .gte('due_at', start)
            .lt('due_at', end)
            .order('due_at')
            .limit(300),
        ),
      ]);
      return json({
        events: (events ?? []).map((e: unknown) => eventOut(e, courses, ctx.tz)),
        work_due: (work ?? []).map((a: unknown) => workOut(a, courses, ctx.tz)),
      });
    },
  },
  {
    name: 'search',
    description: 'Find work, events, courses and inbox thoughts whose title or text contains the words given.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    readOnly: true,
    async run(args, ctx) {
      const q = str(args, 'query', { max: 120, required: true }) as string;
      const like = `%${escapeLike(q)}%`;
      const [courses, work, events, inbox] = await Promise.all([
        loadCourses(ctx, true),
        must(ctx.db.from('assignments').select('id, title, course_id, due_at, due_has_time, status, effort_minutes, grade_percent').eq('user_id', ctx.userId).ilike('title', like).limit(15)),
        must(ctx.db.from('events').select('id, title, kind, course_id, starts_at, ends_at, all_day, location, feed_id').eq('user_id', ctx.userId).ilike('title', like).order('starts_at', { ascending: false }).limit(15)),
        must(ctx.db.from('inbox_items').select('id, body, created_at').eq('user_id', ctx.userId).is('triaged_at', null).is('dismissed_at', null).ilike('body', like).limit(10)),
      ]);
      const needle = q.toLowerCase();
      return json({
        work: (work ?? []).map((a: unknown) => workOut(a, courses, ctx.tz)),
        events: (events ?? []).map((e: unknown) => eventOut(e, courses, ctx.tz)),
        courses: courses.filter((c) => `${c.code ?? ''} ${c.name}`.toLowerCase().includes(needle)).map((c) => ({ id: c.id, code: c.code, name: c.name, archived: c.archived })),
        inbox: (inbox ?? []).map((i: { id: string; body: string; created_at: string }) => ({ id: i.id, text: i.body, added: localDayKey(new Date(i.created_at), ctx.tz) })),
      });
    },
  },
  {
    name: 'list_courses',
    description: "The user's courses, with codes and ids. Archived ones (past terms) only when asked for.",
    inputSchema: { type: 'object', properties: { include_archived: { type: 'boolean' } }, additionalProperties: false },
    readOnly: true,
    async run(args, ctx) {
      const courses = await loadCourses(ctx, bool(args, 'include_archived', false));
      return json(courses.map((c) => ({ id: c.id, code: c.code, name: c.name, ...(c.archived ? { archived: true } : {}) })));
    },
  },
  {
    name: 'add_work',
    description:
      "Add an assignment or other piece of work. Only the title is required. A due date without a time means the end of that day. Dates and times are the user's local time.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        course: { type: 'string', description: 'Course code, name or id' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        due_time: { type: 'string', description: 'HH:MM, 24-hour' },
        estimate_minutes: { type: 'integer', minimum: 5, maximum: 6000 },
        notes: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    readOnly: false,
    async run(args, ctx) {
      const title = str(args, 'title', { max: 200, required: true }) as string;
      const dueDay = day(args, 'due_date');
      const dueTime = time(args, 'due_time');
      if (dueTime && !dueDay) throw new ToolError('A due time needs a due date.');
      const courses = await loadCourses(ctx);
      const courseId = resolveCourse(courses, str(args, 'course', { max: 120 }));
      const row = await must(
        ctx.db
          .from('assignments')
          .insert({
            user_id: ctx.userId,
            title,
            course_id: courseId,
            due_at: dueDay ? dueInstant(dueDay, dueTime, ctx.tz) : null,
            due_has_time: Boolean(dueTime),
            effort_minutes: int(args, 'estimate_minutes', 5, 6000),
            notes: str(args, 'notes', { max: 2000 }),
          })
          .select('id, title, course_id, due_at, due_has_time, status, effort_minutes, grade_percent')
          .single(),
      );
      const err = await record(ctx, 'add_work', 'assignments', row.id, null, `Added “${title}”`);
      if (err) {
        await ctx.db.from('assignments').delete().eq('id', row.id);
        throw new Error(err.message);
      }
      return json({ added: workOut(row, courses, ctx.tz) });
    },
  },
  {
    name: 'add_event',
    description: "Add an exam, lab, presentation or other event on the user's calendar. Without a time it is all day.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: [...EVENT_KINDS] },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM, 24-hour start' },
        minutes: { type: 'integer', minimum: 5, maximum: 1440, description: 'How long, for a timed event' },
        course: { type: 'string' },
        location: { type: 'string' },
      },
      required: ['title', 'date'],
      additionalProperties: false,
    },
    readOnly: false,
    async run(args, ctx) {
      const title = str(args, 'title', { max: 200, required: true }) as string;
      const kind = str(args, 'kind', { max: 20 }) ?? 'other';
      if (!(EVENT_KINDS as readonly string[]).includes(kind)) throw new ToolError(`"kind" must be one of ${EVENT_KINDS.join(', ')}.`);
      const d = day(args, 'date', true) as string;
      const t = time(args, 'time');
      const minutes = int(args, 'minutes', 5, 1440);
      const courses = await loadCourses(ctx);
      const courseId = resolveCourse(courses, str(args, 'course', { max: 120 }));
      const start = t ? wallClockToUTC(d, Number(t.slice(0, 2)), Number(t.slice(3)), 0, ctx.tz) : startOfDayUTC(d, ctx.tz);
      const row = await must(
        ctx.db
          .from('events')
          .insert({
            user_id: ctx.userId,
            title,
            kind,
            course_id: courseId,
            starts_at: start.toISOString(),
            ends_at: t && minutes ? new Date(start.getTime() + minutes * 60_000).toISOString() : null,
            all_day: !t,
            location: str(args, 'location', { max: 200 }),
          })
          .select('id, title, kind, course_id, starts_at, ends_at, all_day, location, feed_id')
          .single(),
      );
      const err = await record(ctx, 'add_event', 'events', row.id, null, `Added the event “${title}”`);
      if (err) {
        await ctx.db.from('events').delete().eq('id', row.id);
        throw new Error(err.message);
      }
      return json({ added: eventOut(row, courses, ctx.tz) });
    },
  },
  {
    name: 'add_to_inbox',
    description: "Put a thought in the user's inbox to sort later, exactly as worded. Use when something is not clearly a piece of work with a date.",
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    readOnly: false,
    async run(args, ctx) {
      const text = str(args, 'text', { max: 1000, required: true }) as string;
      const row = await must(ctx.db.from('inbox_items').insert({ user_id: ctx.userId, body: text, source: 'claude' }).select('id').single());
      const err = await record(ctx, 'add_to_inbox', 'inbox_items', row.id, null, `Put “${text.slice(0, 80)}” in the inbox`);
      if (err) {
        await ctx.db.from('inbox_items').delete().eq('id', row.id);
        throw new Error(err.message);
      }
      return json({ added_to_inbox: { id: row.id, text } });
    },
  },
  {
    name: 'set_work_done',
    description: 'Mark a piece of work done, or reopen it with done: false. Needs the id from an earlier result.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, done: { type: 'boolean' } }, required: ['id'], additionalProperties: false },
    readOnly: false,
    async run(args, ctx) {
      const id = uuid(args, 'id');
      const done = bool(args, 'done', true);
      const before = await must(ctx.db.from('assignments').select('id, title, status, completed_at').eq('user_id', ctx.userId).eq('id', id).maybeSingle());
      if (!before) throw new ToolError('No work with that id. Look it up again with list_work or search.');
      if ((before.status === 'done') === done) return json({ unchanged: `“${before.title}” is already ${done ? 'done' : 'open'}.` });
      await must(
        ctx.db
          .from('assignments')
          .update({ status: done ? 'done' : 'todo', completed_at: done ? ctx.now.toISOString() : null })
          .eq('id', id)
          .select('id')
          .single(),
      );
      const err = await record(ctx, 'set_work_done', 'assignments', id, { status: before.status, completed_at: before.completed_at }, `${done ? 'Marked done' : 'Reopened'}: “${before.title}”`);
      if (err) {
        await ctx.db.from('assignments').update({ status: before.status, completed_at: before.completed_at }).eq('id', id);
        throw new Error(err.message);
      }
      return json({ [done ? 'marked_done' : 'reopened']: { id, title: before.title } });
    },
  },
  {
    name: 'move_work',
    description:
      'Move the due date of a piece of work. Keeps its time of day unless a new time is given. Moving it later is recorded as a deferral, as it is in the app.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, due_time: { type: 'string', description: 'HH:MM, 24-hour' } },
      required: ['id', 'due_date'],
      additionalProperties: false,
    },
    readOnly: false,
    async run(args, ctx) {
      const id = uuid(args, 'id');
      const toDay = day(args, 'due_date', true) as string;
      const newTime = time(args, 'due_time');
      const before = await must(ctx.db.from('assignments').select('id, title, due_at, due_has_time').eq('user_id', ctx.userId).eq('id', id).maybeSingle());
      if (!before) throw new ToolError('No work with that id. Look it up again with list_work or search.');
      const kept = before.due_at && before.due_has_time ? localHourMinute(new Date(before.due_at), ctx.tz) : null;
      const hhmm = newTime ?? (kept ? `${String(kept.hour).padStart(2, '0')}:${String(kept.minute).padStart(2, '0')}` : null);
      const dueAt = dueInstant(toDay, hhmm, ctx.tz);
      await must(ctx.db.from('assignments').update({ due_at: dueAt, due_has_time: Boolean(hhmm) }).eq('id', id).select('id').single());

      const fromDay = before.due_at ? localDayKey(new Date(before.due_at), ctx.tz) : null;
      let deferralId: string | null = null;
      if (fromDay && toDay > fromDay) {
        const d = await ctx.db.from('deferrals').insert({ user_id: ctx.userId, assignment_id: id, from_day: fromDay, to_day: toDay }).select('id').single();
        deferralId = d.data?.id ?? null;
      }
      const err = await record(
        ctx,
        'move_work',
        'assignments',
        id,
        { due_at: before.due_at, due_has_time: before.due_has_time, deferral_id: deferralId },
        `Moved “${before.title}” to ${toDay}${hhmm ? ` ${hhmm}` : ''}`,
      );
      if (err) {
        await ctx.db.from('assignments').update({ due_at: before.due_at, due_has_time: before.due_has_time }).eq('id', id);
        if (deferralId) await ctx.db.from('deferrals').delete().eq('id', deferralId);
        throw new Error(err.message);
      }
      return json({ moved: { id, title: before.title, due: when(dueAt, Boolean(hhmm), ctx.tz) } });
    },
  },
];

export function connectorInstructions(tz: string): string {
  return [
    "This is the user's student planner. Every date and time you read or write is in their time zone, " + tz + '.',
    'Read before you write: use get_today, list_work or search to find ids. Changes save immediately and the user can undo them in the app, under Settings, Connected apps.',
    'Nothing can be deleted through this connection; if the user wants something removed, tell them to do it in the app.',
    'Never invent a deadline. If a date is unclear, ask the user or put the thought in the inbox.',
  ].join(' ');
}
