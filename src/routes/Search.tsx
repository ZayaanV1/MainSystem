import { useEffect, useRef, useState } from 'react';
import { SectionHead } from '../components/SectionHead';
import { Pressable } from '../components/Pressable';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { search } from '../lib/search';
import type { SearchHit } from '../lib/searchRank';
import { courseHits, jumps, splitMatch, type JumpId } from '../lib/searchJumps';
import { readRecent } from '../lib/recent';
import { courseVar, type TodayData } from '../lib/planner';
import { formatDay, type DayKey } from '../lib/time';
import { useNow } from '../lib/useNow';

/**
 * One box, everything in it.
 *
 * By week ten a term holds a few hundred rows across five tables and "where
 * did I put that" becomes its own task. Searching one table at a time would
 * just move the hunting.
 *
 * Results are grouped by kind rather than interleaved, because the first thing
 * you know about what you are looking for is usually what sort of thing it is,
 * and a flat list makes you re-read every row to find that out.
 *
 * Empty, it starts somewhere (the UI overview): the four questions people
 * search for, each course, and what was opened recently — all answered from
 * the day already loaded, so a tap costs no query.
 */

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  assignment: 'Work',
  event: 'Events',
  inbox: 'Inbox',
  course: 'Courses',
};

const ORDER: SearchHit['kind'][] = ['assignment', 'event', 'inbox', 'course'];

type Shortcut = { jump: JumpId } | { course: string } | null;

export function Search({
  data,
  onOpenAssignment,
  onOpenDay,
  onOpenInbox,
  onOpenCourses,
}: {
  data: TodayData | null;
  onOpenAssignment: (id: string) => void;
  /** An event: its day in Month. */
  onOpenDay: (day: DayKey) => void;
  /** A captured thought still to sort: triage it. */
  onOpenInbox: (id: string) => void;
  onOpenCourses: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [shortcut, setShortcut] = useState<Shortcut>(null);
  const [recent] = useState(readRecent);
  const now = useNow();

  // Guards against an earlier query's results landing after a later one's and
  // overwriting them, which reads as the box ignoring what you typed.
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }

    const ticket = ++latest.current;
    setSearching(true);

    // Debounced: a query per keystroke would be five round trips for a word.
    const timer = setTimeout(() => {
      void search(q).then((results) => {
        if (ticket !== latest.current) return;
        setHits(results.hits);
        setFailed(results.failed);
        setSearching(false);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const typing = query.trim().length >= 2;
  const loaded = data ? { assignments: data.assignments, events: data.events, courses: data.courses } : null;
  const offered = loaded ? jumps(loaded, now) : [];
  const courses = data?.courses ?? [];

  // A shortcut's list, answered from the loaded day.
  const shortcutHits: SearchHit[] | null =
    !loaded || !shortcut
      ? null
      : 'jump' in shortcut
        ? (offered.find((j) => j.id === shortcut.jump)?.hits ?? [])
        : courseHits(loaded, shortcut.course, now);
  const shortcutLabel =
    shortcut && 'jump' in shortcut
      ? offered.find((j) => j.id === shortcut.jump)?.label
      : shortcut
        ? (() => {
            const c = courses.find((x) => x.id === shortcut.course);
            return c ? (c.code ?? c.name) : null;
          })()
        : null;

  const grouped = ORDER.map((kind) => ({
    kind,
    items: (hits ?? []).filter((h) => h.kind === kind),
  })).filter((g) => g.items.length > 0);

  /*
    Every result that looks pressable does something. Only work used to: an
    event, an inbox item or a course lit up under a finger and then did
    nothing, and finished work did nothing either because the shell only
    looked among open work.
  */
  const openFor = (h: SearchHit) =>
    h.kind === 'assignment'
      ? () => onOpenAssignment(h.id)
      : h.kind === 'event' && h.day
        ? () => onOpenDay(h.day as DayKey)
        : h.kind === 'inbox' && !h.done
          ? () => onOpenInbox(h.id)
          : h.kind === 'course'
            ? onOpenCourses
            : null;

  const row = (h: SearchHit, mark: string) => {
    const open = openFor(h);
    const body = (
      <>
        <span className={`type-body min-w-0 ${h.done ? 'text-text-low' : 'text-text-hi'}`}>
          {/* What was typed, marked, so the eye finds why each row matched. */}
          {splitMatch(h.title, mark).map((part, i) =>
            part.match ? (
              <mark key={i} className="search-mark">
                {part.text}
              </mark>
            ) : (
              part.text
            ),
          )}
        </span>
        <span className="type-note shrink-0 text-text-low">
          {[h.detail, h.day ? formatDay(h.day) : null, h.done ? 'done' : null].filter(Boolean).join(' · ')}
        </span>
      </>
    );
    return open ? (
      <Pressable align="baseline" className="mat-row justify-between gap-4 px-4 py-3" key={`${h.kind}:${h.id}`} onClick={open}>
        {body}
      </Pressable>
    ) : (
      // A thought already sorted into work: a record, not a control.
      <div key={`${h.kind}:${h.id}`} className="mat-row flex items-baseline justify-between gap-4 px-4 py-3">
        {body}
      </div>
    );
  };

  return (
    <main className="page-frame">
      <header className="mb-4 px-4">
        <h1 className="page-title">Search</h1>
      </header>

      <div className="relative mb-6">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-low"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length >= 2) setShortcut(null);
          }}
          placeholder="Work, events, the inbox, courses"
          aria-label="Search"
          autoFocus
          enterKeyHint="search"
          className="well capture-well w-full pl-11 type-body"
        />
      </div>

      <div className="flex-1">
        {typing ? (
          hits === null || searching ? (
            <p className="px-4 type-note text-text-low">Looking…</p>
          ) : failed && hits.length === 0 ? (
            <p role="alert" className="px-4 type-note text-text-mid">
              Couldn&rsquo;t search just now. Check your connection and try again.
            </p>
          ) : hits.length === 0 ? (
            <EmptyState>Nothing matches "{query.trim()}".</EmptyState>
          ) : (
            grouped.map(({ kind, items }) => (
              <section key={kind} className="enter-fade mb-6">
                <SectionHead title={KIND_LABEL[kind]} count={items.length} />
                <div className="mat flex flex-col">{items.map((h) => row(h, query))}</div>
              </section>
            ))
          )
        ) : (
          <div className="flex flex-col gap-6">
            {offered.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="kicker px-4" id="jump-label">
                  Jump to
                </span>
                <div className="chip-row" role="group" aria-labelledby="jump-label">
                  {offered.map((j) => {
                    const on = Boolean(shortcut && 'jump' in shortcut && shortcut.jump === j.id);
                    return (
                      <Chip key={j.id} selected={on} onClick={() => setShortcut(on ? null : { jump: j.id })}>
                        {j.label} · {j.hits.length}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {courses.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="kicker px-4" id="course-label">
                  Courses
                </span>
                <div className="chip-row" role="group" aria-labelledby="course-label">
                  {courses.map((c) => {
                    const on = Boolean(shortcut && 'course' in shortcut && shortcut.course === c.id);
                    return (
                      <Chip
                        key={c.id}
                        courseVar={courseVar(c.colour_index)}
                        selected={on}
                        onClick={() => setShortcut(on ? null : { course: c.id })}
                      >
                        {c.code ?? c.name}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {shortcutHits ? (
              <section key={JSON.stringify(shortcut)} className="enter-fade">
                <SectionHead title={shortcutLabel ?? 'Results'} count={shortcutHits.length} />
                {shortcutHits.length === 0 ? (
                  <EmptyState>Nothing open here.</EmptyState>
                ) : (
                  <div className="mat flex flex-col">{shortcutHits.map((h) => row(h, ''))}</div>
                )}
              </section>
            ) : recent.length > 0 ? (
              <section>
                <SectionHead title="Opened recently" />
                <div className="mat flex flex-col">
                  {recent.map((o) => {
                    // Read against the loaded day when it is there, so the
                    // detail is current; otherwise the title it had.
                    const a = data?.assignments.find((x) => x.id === o.id);
                    const c = a ? courses.find((x) => x.id === a.course_id) : null;
                    return row(
                      {
                        kind: 'assignment',
                        id: o.id,
                        title: a?.title ?? o.title,
                        detail: c ? (c.code ?? c.name) : null,
                        day: null,
                        done: false,
                      },
                      '',
                    );
                  })}
                </div>
              </section>
            ) : (
              <EmptyState>Type two letters to search work, events, the inbox and courses.</EmptyState>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
