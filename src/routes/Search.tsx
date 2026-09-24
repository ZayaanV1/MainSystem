import { useEffect, useRef, useState } from 'react';
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
        <h1 className="type-h1 text-text-hi">Search</h1>
        <Button variant="quiet" onClick={onBack}>
          Today
        </Button>
      </header>

      <div className="mb-6 px-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Anything"
          autoFocus
          className="well type-body text-text-hi placeholder:text-text-low"
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
              <h2 className="type-h2 mb-2 px-4 text-text-hi">{KIND_LABEL[kind]}</h2>
              <div className="flex flex-col">
                {items.map((h) => (
                  <Pressable align="baseline" className="justify-between gap-4 border-b border-ink-600 px-4 py-3 last:border-b-0"
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
