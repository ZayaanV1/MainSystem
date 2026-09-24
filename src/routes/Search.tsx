import { useEffect, useRef, useState } from 'react';
import { SectionHead } from '../components/SectionHead';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { search } from '../lib/search';
import type { SearchHit } from '../lib/searchRank';
import { formatDay } from '../lib/time';

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
 */

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  assignment: 'Work',
  event: 'Events',
  inbox: 'Inbox',
  course: 'Courses',
  food: 'Food',
};

const ORDER: SearchHit['kind'][] = ['assignment', 'event', 'inbox', 'course', 'food'];

export function Search({
  onBack,
  onOpenAssignment,
}: {
  onBack: () => void;
  onOpenAssignment: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

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
        setHits(results);
        setSearching(false);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const grouped = ORDER.map((kind) => ({
    kind,
    items: (hits ?? []).filter((h) => h.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="page-frame">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <h1 className="page-title">Search</h1>
        <Button variant="quiet" onClick={onBack}>
          Today
        </Button>
      </header>

      <div className="relative mb-8 px-4">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-8 -translate-y-1/2 text-text-low"
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
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Anything"
          aria-label="Search"
          autoFocus
          className="well capture-well pl-11 type-body"
        />
      </div>

      <div className="flex-1">
        {query.trim().length < 2 ? (
          <EmptyState>Type two letters. Searches work, events, the inbox, courses and food.</EmptyState>
        ) : hits === null || searching ? (
          <p className="px-4 type-note text-text-low">Looking…</p>
        ) : hits.length === 0 ? (
          <EmptyState>Nothing matches "{query.trim()}".</EmptyState>
        ) : (
          grouped.map(({ kind, items }) => (
            <section key={kind} className="mb-6">
              <SectionHead title={KIND_LABEL[kind]} count={items.length} />
              <div className="mat flex flex-col">
                {items.map((h) => (
                  <Pressable align="baseline" className="mat-row justify-between gap-4 px-4 py-3"
                    key={`${h.kind}:${h.id}`}
                    onClick={() => h.kind === 'assignment' && onOpenAssignment(h.id)}>
                    <span className={`type-body ${h.done ? 'text-text-low' : 'text-text-hi'}`}>
                      {h.title}
                    </span>
                    <span className="type-note shrink-0 text-text-low">
                      {[h.detail, h.day ? formatDay(h.day) : null].filter(Boolean).join(' · ')}
                    </span>
                  </Pressable>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
