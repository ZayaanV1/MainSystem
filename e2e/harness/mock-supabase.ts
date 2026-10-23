// An in-memory stand-in for src/lib/supabase.ts, so the real app runs on
// sample data for the end-to-end tests in e2e/ and for visual checks. Never
// part of the build: only e2e/harness/vite.config.ts swaps it in.
//
// The sample is dated relative to the browser's today in the account's zone,
// so a test that fixes the clock gets the same week every run.
//
// URL switches: ?signedout starts signed out, ?firstrun starts at the first
// run, ?skin=<theme> picks a theme.
/* eslint-disable @typescript-eslint/no-explicit-any */

const params = new URLSearchParams(location.search);
const USER = 'c0ffee00-0000-4000-8000-000000000001';
const TZ = 'America/Toronto';

const pad = (n: number) => String(n).padStart(2, '0');
function localDay(offset = 0): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, dd] = parts.split('-').map(Number);
  const u = new Date(Date.UTC(y, m - 1, dd + offset, 12));
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`;
}
/** A local wall-clock time `offset` days from today, as an ISO instant (EDT/EST aware). */
function at(offset: number, h: number, m = 0): string {
  const day = localDay(offset);
  for (const off of [-4, -5]) {
    const iso = `${day}T${pad(h)}:${pad(m)}:00${off < 0 ? '-' : '+'}0${Math.abs(off)}:00`;
    const d = new Date(iso);
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d);
    if (Number(back) % 24 === h) return d.toISOString();
  }
  return new Date(`${day}T${pad(h)}:${pad(m)}:00-04:00`).toISOString();
}
const id = (p: string, n: number) => `a000000${p === 'a' ? 0 : p === 'c' ? 1 : p === 'e' ? 2 : p === 'i' ? 3 : p === 's' ? 4 : p === 'm' ? 5 : 6}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ?board=due:s,clock:peg,... puts exactly those widgets on the board, for
// checking every widget at every size without dragging each one in.
function boardParam() {
  const raw = params.get('board');
  if (!raw) return null;
  return raw.split(',').filter(Boolean).map((pair, i) => {
    const [type, size] = pair.split(':');
    return { id: `h${i}`, type, size, opts: {} };
  });
}

const C = {
  coen231: id('c', 1), coen212: id('c', 2), engr201: id('c', 3), math205: id('c', 4), phys205: id('c', 5),
};

const db: Record<string, any[]> = {
  app_settings: [{
    user_id: USER, timezone: TZ, low_battery: false, digest_hour: 7, digest_minute: 0, digest_enabled: true,
    assignment_window_days: 7, event_window_days: 14, weekly_review_enabled: true, weekly_review_weekday: 7,
    onboarded_at: params.has('firstrun') ? null : at(-20, 9), abood_checkins: true, abood_checkin_every_hours: null,
    abood_checkin_from: 10, abood_checkin_until: 21, theme: params.get('skin'), today_order: null, today_hidden: null, modules_off: null, board: boardParam(),
  }],
  courses: [
    { id: C.coen231, user_id: USER, name: 'Computer Organization', code: 'COEN 231', colour_index: 3, archived: false },
    { id: C.coen212, user_id: USER, name: 'Digital Systems Design', code: 'COEN 212', colour_index: 1, archived: false },
    { id: C.engr201, user_id: USER, name: 'Professional Practice', code: 'ENGR 201', colour_index: 4, archived: false },
    { id: C.math205, user_id: USER, name: 'Differential and Integral Calculus II', code: 'MATH 205', colour_index: 2, archived: false },
    { id: C.phys205, user_id: USER, name: 'Waves and Optics', code: 'PHYS 205', colour_index: 5, archived: false },
  ],
  assignments: [
    { id: id('a', 1), user_id: USER, course_id: C.coen212, title: 'Lab 3 report: sequential circuits', due_at: at(-1, 23, 59), due_has_time: false, effort_minutes: 120, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: 5, grade_percent: null, link: 'https://moodle.example.edu/mod/assign/view.php?id=42', completed_at: null },
    { id: id('a', 2), user_id: USER, course_id: C.math205, title: 'WeBWorK set 5', due_at: at(0, 15, 0), due_has_time: true, effort_minutes: 45, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: null, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 3), user_id: USER, course_id: C.phys205, title: 'Problem set 4: interference', due_at: at(0, 23, 59), due_has_time: false, effort_minutes: 90, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: 4, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 4), user_id: USER, course_id: C.coen231, title: 'Read chapter 6 and annotate', due_at: at(1, 23, 59), due_has_time: false, effort_minutes: 60, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: null, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 5), user_id: USER, course_id: C.engr201, title: 'Ethics case study: first draft', due_at: at(3, 23, 59), due_has_time: false, effort_minutes: 240, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: 15, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 6), user_id: USER, course_id: C.coen231, title: 'Assembly assignment 2', due_at: at(6, 17, 0), due_has_time: true, effort_minutes: 300, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: 10, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 7), user_id: USER, course_id: C.phys205, title: 'Quiz 3 prep', due_at: at(12, 23, 59), due_has_time: false, effort_minutes: null, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: null, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 8), user_id: USER, course_id: C.coen212, title: 'Email the TA about the lab regrade', due_at: null, due_has_time: false, effort_minutes: null, actual_minutes: null, status: 'todo', notes: null, start_by_override: null, remind_at: null, weight_percent: null, grade_percent: null, link: null, completed_at: null },
    { id: id('a', 9), user_id: USER, course_id: C.coen212, title: 'Lab 2 report', due_at: at(-8, 23, 59), due_has_time: false, effort_minutes: 120, actual_minutes: 150, status: 'done', notes: null, start_by_override: null, remind_at: null, weight_percent: 5, grade_percent: 86, link: null, completed_at: at(-9, 20) },
    { id: id('a', 10), user_id: USER, course_id: C.math205, title: 'WeBWorK set 4', due_at: at(-7, 15), due_has_time: true, effort_minutes: 45, actual_minutes: 40, status: 'done', notes: null, start_by_override: null, remind_at: null, weight_percent: 2, grade_percent: 92, link: null, completed_at: at(-7, 12) },
  ],
  events: [
    { id: id('e', 1), user_id: USER, course_id: C.coen212, title: 'COEN 212 office hours', kind: 'other', starts_at: at(0, 17), ends_at: at(0, 18), all_day: false, location: 'EV 5.139', feed_id: null },
    { id: id('e', 2), user_id: USER, course_id: C.coen231, title: 'Study group: COEN 231', kind: 'other', starts_at: at(0, 20), ends_at: at(0, 21, 30), all_day: false, location: 'Webster Library, LB-251', feed_id: null },
    { id: id('e', 3), user_id: USER, course_id: null, title: 'Shift at the library', kind: 'other', starts_at: at(0, 12), ends_at: at(0, 16), all_day: false, location: null, feed_id: null },
    { id: id('e', 4), user_id: USER, course_id: C.coen212, title: 'H 937 - COEN 212-U - LEC', kind: 'other', starts_at: at(1, 10, 15), ends_at: at(1, 11, 30), all_day: false, location: 'Hall Building, H-937', feed_id: id('f', 1) },
    { id: id('e', 5), user_id: USER, course_id: C.coen231, title: 'MB S2.210 - COEN 231-U - LEC', kind: 'other', starts_at: at(1, 13, 15), ends_at: at(1, 14, 30), all_day: false, location: 'John Molson, S2.210', feed_id: id('f', 1) },
    { id: id('e', 6), user_id: USER, course_id: C.phys205, title: 'PHYS 205 Midterm', kind: 'exam', starts_at: at(2, 18), ends_at: at(2, 20), all_day: false, location: 'Hall Building, H-110', feed_id: null },
    { id: id('e', 7), user_id: USER, course_id: C.engr201, title: 'ENGR 201 tutorial', kind: 'other', starts_at: at(3, 9), ends_at: at(3, 10), all_day: false, location: 'FG B055', feed_id: null },
  ],
  calendar_feeds: [{ id: id('f', 1), user_id: USER, label: 'Concordia timetable', url: 'https://example.edu/feed.ics', last_synced_at: at(0, 8), last_attempt_at: at(0, 8), last_status: 'ok', last_error: null, last_problems: [], created_at: at(-20, 9) }],
  checklist_items: [
    { id: id('i', 1), user_id: USER, title: 'Take medication', recurrence: 'daily', weekdays: null, interval_days: null, anchor_day: null, active: true, sort_order: 1, essential: true, remind_at: '08:30', tracks_doses: true, doses_remaining: 9, doses_per_completion: 1, refill_warning_days: 5 },
    { id: id('i', 2), user_id: USER, title: 'Review the day’s notes', recurrence: 'daily', weekdays: null, interval_days: null, anchor_day: null, active: true, sort_order: 2, essential: false, remind_at: null, tracks_doses: false, doses_remaining: null, doses_per_completion: 1, refill_warning_days: 5 },
    { id: id('i', 3), user_id: USER, title: 'Plan tomorrow', recurrence: 'daily', weekdays: null, interval_days: null, anchor_day: null, active: true, sort_order: 3, essential: false, remind_at: null, tracks_doses: false, doses_remaining: null, doses_per_completion: 1, refill_warning_days: 5 },
  ],
  checklist_completions: [
    { user_id: USER, item_id: id('i', 1), local_day: localDay(0) },
    { user_id: USER, item_id: id('i', 1), local_day: localDay(-1) },
    { user_id: USER, item_id: id('i', 2), local_day: localDay(-1) },
  ],
  inbox_items: [
    { id: id('i', 11), user_id: USER, body: 'chem lab?? ask about the extension', source: 'app', created_at: at(0, 9), triaged_at: null, dismissed_at: null },
    { id: id('i', 12), user_id: USER, body: 'buy a scientific calculator before the midterm', source: 'telegram', created_at: at(-1, 22), triaged_at: null, dismissed_at: null },
  ],
  subtasks: [
    { id: id('s', 1), user_id: USER, assignment_id: id('a', 5), title: 'Pick the case and skim the brief', done: true, position: 0 },
    { id: id('s', 2), user_id: USER, assignment_id: id('a', 5), title: 'Write three possible thesis sentences', done: true, position: 1 },
    { id: id('s', 3), user_id: USER, assignment_id: id('a', 5), title: 'Outline the four stakeholder sections', done: false, position: 2 },
    { id: id('s', 4), user_id: USER, assignment_id: id('a', 5), title: 'Draft the first two sections', done: false, position: 3 },
  ],
  deferrals: Array.from({ length: 7 }, (_, n) => ({ id: id('d', n + 1), user_id: USER, assignment_id: id('a', 8), created_at: at(-n - 1, 10) })),
  assignment_series: [],
  assignment_files: [],
  class_series: [
    { id: id('s', 9), user_id: USER, course_id: C.coen231, title: 'COEN 231 Lecture', weekdays: [2, 4], start_time: '10:15', end_time: '11:30', location: 'H 937', first_day: localDay(-44), last_day: localDay(47), skip_days: [], created_at: at(-50, 9) },
  ],
  goals: [
    { id: id('g', 1), user_id: USER, title: 'Read Leviathan', unit: 'chapters', have: 9, target: 15, by_day: localDay(19), created_at: at(-10, 9) },
  ],
  chat_messages: [
    { id: id('m', 1), user_id: USER, role: 'user', content: 'what do i have tomorrow?', proposed_action: null, action_taken: false, referenced_ids: null, failed: false, via: 'app', created_at: at(-1, 21, 3) },
    { id: id('m', 2), user_id: USER, role: 'assistant', content: 'Tomorrow is lighter than today.\n\nThe chapter 6 reading for COEN 231 is due at 11:59 p.m., and that is the only deadline.', proposed_action: null, action_taken: false, referenced_ids: null, failed: false, via: 'app', created_at: at(-1, 21, 3) },
  ],
  delivery_log: [
    { id: id('l', 1), user_id: USER, kind: 'digest', status: 'sent', channel: 'webpush', error: null, created_at: at(0, 7), dedupe_key: 'd' },
  ],
  notification_channels: [{ id: id('n', 1), user_id: USER, kind: 'webpush', priority: 10, enabled: true }],
  push_subscriptions: [],
  memory_facts: [
    { id: id('m', 51), user_id: USER, fact: 'Prefers to do problem sets in the evening', created_at: at(-5, 20) },
    { id: id('m', 52), user_id: USER, fact: 'The COEN 212 TA is Priya; lab regrade requests go to her by email', course_id: C.coen212, created_at: at(-3, 20) },
    { id: id('m', 53), user_id: USER, fact: 'COEN 212 labs are in H-821 on Thursdays', course_id: C.coen212, created_at: at(-2, 20) },
  ],
  telegram_link_codes: [], imessage_links: [], imessage_bridges: [],
  course_pages: [
    {
      course_id: C.coen212, user_id: USER, notes: '', office_hours: 'Wed 1:30-3 p.m., EV 5.139', contacts: 'Prof. Haddad, haddad@example.edu', updated_at: at(-4, 12),
      links: [{ label: 'Moodle', url: 'https://moodle.example.edu/course/view.php?id=212' }, { label: 'Lab manual', url: 'https://example.edu/coen212/lab-manual.pdf' }],
      syllabus_text: 'Evaluation\nLabs (6) .......... 30%\nMidterm ......... 25%  October 21\nFinal exam ...... 45%',
    },
  ],
};

/* ---------------------------------------------------------------- queries */

function get(row: any, path: string) {
  return path.split('.').reduce((v, k) => (v == null ? v : v[k]), row);
}

class Query {
  private filters: ((r: any) => boolean)[] = [];
  private orders: { key: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private lim: number | null = null;
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: any = null;
  private one: 'single' | 'maybe' | null = null;
  private countMode = false;
  private head = false;
  private embeds: string[] = [];
  constructor(private table: string) {
    db[table] ??= [];
  }
  select(cols = '*', opts: any = {}) {
    if (this.op === 'select') this.op = 'select';
    if (opts.count) this.countMode = true;
    if (opts.head) this.head = true;
    this.embeds = [...cols.matchAll(/(\w+)(!inner)?\(/g)].map((m) => m[1]);
    return this;
  }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
  private conflict = 'id';
  upsert(p: any, o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.conflict = o?.onConflict ?? 'id'; return this; }
  update(p: any) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k: string, v: any) { this.filters.push((r) => get(this.row(r), k) === v); return this; }
  neq(k: string, v: any) { this.filters.push((r) => get(this.row(r), k) !== v); return this; }
  is(k: string, v: any) { this.filters.push((r) => (get(r, k) ?? null) === v); return this; }
  not(k: string, op: string, v: any) { this.filters.push((r) => !(op === 'is' ? (get(r, k) ?? null) === v : get(r, k) === v)); return this; }
  in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(get(r, k))); return this; }
  gte(k: string, v: any) { this.filters.push((r) => get(r, k) != null && get(r, k) >= v); return this; }
  gt(k: string, v: any) { this.filters.push((r) => get(r, k) != null && get(r, k) > v); return this; }
  lte(k: string, v: any) { this.filters.push((r) => get(r, k) != null && get(r, k) <= v); return this; }
  lt(k: string, v: any) { this.filters.push((r) => get(r, k) != null && get(r, k) < v); return this; }
  ilike(k: string, pat: string) {
    const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
    this.filters.push((r) => re.test(String(get(r, k) ?? '')));
    return this;
  }
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.split('.'));
    this.filters.push((r) => parts.some(([k, op, ...rest]) => {
      const v = rest.join('.').replace(/^"|"$/g, '');
      if (op === 'ilike') return new RegExp('^' + v.replace(/%/g, '.*') + '$', 'i').test(String(r[k] ?? ''));
      if (op === 'eq') return String(r[k]) === v;
      return false;
    }));
    return this;
  }
  contains(k: string, v: any[]) { this.filters.push((r) => Array.isArray(r[k]) && v.every((x) => r[k].includes(x))); return this; }
  match(o: Record<string, any>) { for (const [k, v] of Object.entries(o)) this.eq(k, v); return this; }
  filter(k: string, op: string, v: any) {
    if (op === 'eq') return this.eq(k, v);
    if (op === 'neq') return this.neq(k, v);
    if (op === 'gte') return this.gte(k, v);
    if (op === 'lte') return this.lte(k, v);
    if (op === 'lt') return this.lt(k, v);
    if (op === 'gt') return this.gt(k, v);
    return this;
  }
  order(key: string, o: any = {}) { this.orders.push({ key, asc: o.ascending ?? true, nullsFirst: o.nullsFirst }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.lim = b - a + 1; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  returns() { return this; }
  throwOnError() { return this; }

  /** A row with its embedded relations attached, for filters like assignments.status. */
  private row(r: any) {
    const out = { ...r };
    for (const e of this.embeds) {
      if (e === 'assignments') out.assignments = db.assignments.find((a) => a.id === r.assignment_id) ?? null;
      if (e === 'calendar_feeds') out.calendar_feeds = r.feed_id ? db.calendar_feeds.find((f) => f.id === r.feed_id) ?? null : null;
      if (e === 'courses') out.courses = db.courses.find((c) => c.id === r.course_id) ?? null;
    }
    return out;
  }

  private run() {
    const rows = db[this.table];
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: any) => ({
        id: p.id ?? crypto.randomUUID(), user_id: USER, created_at: new Date().toISOString(), ...p,
      }));
      const key = this.op === 'upsert' ? this.conflict : 'id';
      for (const r of list) {
        const i = rows.findIndex((x) => x[key] === r[key]);
        if (i >= 0) rows[i] = { ...rows[i], ...r, id: rows[i].id }; else rows.push(r);
      }
      return { data: this.one ? list[0] : list, error: null };
    }
    const hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      for (const r of hit) Object.assign(r, this.payload);
      return { data: hit, error: null };
    }
    if (this.op === 'delete') {
      db[this.table] = rows.filter((r) => !hit.includes(r));
      return { data: hit, error: null };
    }
    let out = hit.map((r) => this.row(r));
    for (const o of [...this.orders].reverse()) {
      out = out.slice().sort((a, b) => {
        const x = get(a, o.key), y = get(b, o.key);
        if (x == null && y == null) return 0;
        if (x == null) return o.nullsFirst ? -1 : 1;
        if (y == null) return o.nullsFirst ? 1 : -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (this.lim != null) out = out.slice(0, this.lim);
    if (this.countMode) return { data: this.head ? null : out, count: out.length, error: null };
    if (this.one) return { data: out[0] ?? null, error: this.one === 'single' && !out[0] ? { message: 'No rows' } : null };
    return { data: out, error: null };
  }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
}

/* ------------------------------------------------------------------- auth */

const session = params.has('signedout')
  ? null
  : { access_token: 'sample', refresh_token: 'sample', expires_at: Date.now() / 1000 + 3600, user: { id: USER, email: 'student@example.com' } };
let current: any = session;
const listeners = new Set<(e: string, s: any) => void>();

export const isConfigured = true;
export const supabase: any = {
  from: (t: string) => new Query(t),
  rpc: async (name: string, args: any = {}) => {
    if (name === 'own_key_status') return { data: [{ gemini: false, groq: true }], error: null };
    // save_class and delete_class as migration 0038 writes them: the class row,
    // then removals, updates and inserts of its own sessions, all or nothing.
    if (name === 'save_class') {
      const c = args.p_class;
      const mine = (id: string) => db.events.find((e) => e.id === id && e.series_id === c.id);
      if ((args.p_remove ?? []).some((id: string) => !mine(id)) || (args.p_update ?? []).some((u: any) => !mine(u.id))) {
        return { data: null, error: { message: 'This class changed somewhere else. Nothing was saved.', code: '40001' } };
      }
      const row = { ...c, user_id: USER, location: c.location || null };
      const i = db.class_series.findIndex((s) => s.id === c.id);
      if (i >= 0) db.class_series[i] = { ...db.class_series[i], ...row }; else db.class_series.push({ ...row, created_at: new Date().toISOString() });
      db.events = db.events.filter((e) => !(args.p_remove ?? []).includes(e.id));
      const fields = { title: row.title, course_id: row.course_id, location: row.location };
      for (const u of args.p_update ?? []) Object.assign(mine(u.id), { starts_at: u.starts_at, ends_at: u.ends_at, ...fields });
      for (const n of args.p_insert ?? []) {
        db.events.push({ id: crypto.randomUUID(), user_id: USER, kind: 'class', all_day: false, feed_id: null, series_id: c.id, starts_at: n.starts_at, ends_at: n.ends_at, ...fields });
      }
      return { data: (args.p_remove ?? []).length + (args.p_update ?? []).length + (args.p_insert ?? []).length, error: null };
    }
    if (name === 'delete_class') {
      const before = db.events.length;
      db.events = db.events.filter((e) => !((args.p_remove ?? []).includes(e.id) && e.series_id === args.p_id));
      for (const e of db.events) if (e.series_id === args.p_id) e.series_id = null;
      db.class_series = db.class_series.filter((s) => s.id !== args.p_id);
      return { data: before - db.events.length, error: null };
    }
    if (name === 'ensure_ics_token') return { data: 'sample-token', error: null };
    return { data: null, error: null };
  },
  auth: {
    getSession: async () => ({ data: { session: current }, error: null }),
    getUser: async () => ({ data: { user: current?.user ?? null }, error: null }),
    onAuthStateChange: (cb: (e: string, s: any) => void) => {
      listeners.add(cb);
      setTimeout(() => cb('INITIAL_SESSION', current), 0);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    signInWithPassword: async ({ email }: any) => {
      current = { ...session, user: { id: USER, email } };
      listeners.forEach((l) => l('SIGNED_IN', current));
      return { data: { session: current }, error: null };
    },
    signUp: async ({ email }: any) => ({ data: { user: { id: USER, email, identities: [{}] }, session: null }, error: null }),
    signOut: async () => { current = null; listeners.forEach((l) => l('SIGNED_OUT', null)); return { error: null }; },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: current?.user }, error: null }),
    // As the real client: a session from tokens always carries its user, and
    // setSession announces SIGNED_IN (recovery is the app's own reading of the link).
    setSession: async (s: any) => { current = { expires_at: Date.now() / 1000 + 3600, ...s, user: { id: USER, email: 'student@example.com' } }; listeners.forEach((l) => l('SIGNED_IN', current)); return { data: { session: current }, error: null }; },
    exchangeCodeForSession: async () => ({ data: { session: current }, error: null }),
  },
};

/* ------------------------------------------------- edge function stand-ins */

const realFetch = window.fetch.bind(window);
/** Storage objects by path, as the work-files bucket would hold them. */
const objects = new Map<string, ArrayBuffer>();
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.includes('/storage/v1/object/')) {
    const method = (init?.method ?? 'GET').toUpperCase();
    const bucket = /\/storage\/v1\/object\/(?:sign\/)?(work-files|board-photos)\//.exec(url);
    if (bucket) {
      const path = decodeURIComponent(url.split(`${bucket[1]}/`)[1].split('?')[0]);
      if (url.includes('/object/sign/') && method === 'POST') {
        return new Response(JSON.stringify({ signedURL: `/object/sign/${bucket[1]}/${path}?token=sample` }), { status: 200 });
      }
      if (url.includes('/object/sign/') && method === 'GET') {
        const bytes = objects.get(path);
        return bytes ? new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }) : new Response('', { status: 404 });
      }
      if (method === 'POST') {
        objects.set(path, await new Response(init?.body as BodyInit).arrayBuffer());
        return new Response(JSON.stringify({ Key: path }), { status: 200 });
      }
    }
    if (method === 'DELETE') {
      for (const p of JSON.parse(String(init?.body ?? '{}')).prefixes ?? []) objects.delete(p);
      return new Response('[]', { status: 200 });
    }
  }
  if (url.includes('/functions/v1/')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/assist') && body.task === 'summary') {
      return json({ ok: true, summary: 'WeBWorK set 5 is due at 3 p.m. and the PHYS problem set tonight, with the midterm on Wednesday. Worth finishing WeBWorK first while the lab report from yesterday waits for the evening.' });
    }
    if (url.includes('/assist') && body.task === 'guide') {
      await new Promise((r) => setTimeout(r, 300));
      return json({
        ok: true,
        warnings: [],
        guide: {
          overview: 'A short problem set on limits. Submit one PDF with your working shown.',
          requirements: ['One PDF', 'Show all working'],
          parts: [{ label: 'Question 1', approach: 'Factor the numerator and cancel the common term before substituting.', concepts: ['Limits', 'Factoring'] }],
          pitfalls: ['Substituting before simplifying'],
          ask: ['Is a scan of handwriting accepted?'],
        },
      });
    }
    if (url.includes('/assist') && body.task === 'syllabus') {
      // What the reader returns for a typical evaluation section, dated
      // relative to today so urgency colours vary.
      const d = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
      await new Promise((r) => setTimeout(r, 600));
      return json({
        ok: true,
        warnings: [],
        items: [
          { title: 'Problem set 1', kind: 'assignment', due_date: d(2), due_time: '23:59', weight_percent: 5 },
          { title: 'Lab 1 report', kind: 'assignment', due_date: d(6), due_time: null, weight_percent: 7.5 },
          { title: 'Midterm', kind: 'exam', due_date: d(16), due_time: '18:00', weight_percent: 25 },
          { title: 'Term project', kind: 'assignment', due_date: null, due_time: null, weight_percent: 20 },
        ],
      });
    }
    if (url.includes('/feeds')) return json({ ok: true, synced: 0, results: [] });
    return json({ ok: false, reason: 'Not available in the sample.' });
  }
  return realFetch(input, init);
};
