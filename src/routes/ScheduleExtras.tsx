import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/Card';
import { Pressable } from '../components/Pressable';
import { SectionHead } from '../components/SectionHead';
import { dailySummary } from '../lib/assist';
import { Mentioned } from '../components/Mentioned';
import { mentionsFrom } from '../lib/mentions';
import { calibration, forecast, stuckTasks } from '../lib/intelligence';
import { closeUp, measureBelow } from '../lib/motion';
import { activeTimezone, type DayKey } from '../lib/time';
import { usePresence } from '../lib/usePresence';
import type { Assignment, InboxItem, TodayData } from '../lib/planner';

/*
 * The parts of Schedule that were on Today until 19 Oct 2026: the briefing,
 * what is ahead (the week's load, how long things take, work that keeps
 * moving) and the inbox. They are all about sorting the work out, so they
 * live where all of the work is; Today keeps the widgets, capture and the
 * checklist.
 */

/** One or two sentences from the model on what to touch first. */
export function Briefing({ dep, today }: { dep: TodayData | null; today: DayKey }) {
  const cacheKey = `planner.briefing:${today}`;
  /*
   * Today's briefing as last seen on this device, shown from the first frame.
   *
   * It used to render nothing until the model answered and then open with a
   * grid-template-rows animation — 420ms of re-laying-out the whole page,
   * every frame, at the exact moment the screen was being read. With the
   * day's text cached, every open after the first shows it at once and the
   * late answer only replaces it if something changed.
   */
  const [text, setText] = useState(() => readBriefing(cacheKey));
  const mentions = useMemo(() => mentionsFrom(dep?.assignments ?? [], dep?.events ?? []), [dep]);
  const [open, setOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const shownAtOpen = useRef(Boolean(text));
  // Opening or closing it moves what is below as a cascade, never a jump.
  const followers = useRef<Map<HTMLElement, number> | null>(null);
  useLayoutEffect(() => {
    if (!followers.current) return;
    closeUp(followers.current);
    followers.current = null;
  }, [open]);

  useEffect(() => {
    setText(readBriefing(cacheKey));
  }, [cacheKey]);

  /*
   * Re-asked whenever the day's data reloads — ticking something off should
   * change the briefing. That is cheap on purpose: the server keys its cache
   * on a fingerprint of the work itself, so a repeat ask costs a query and no
   * model call unless something actually moved.
   *
   * `live` guards the late reply. Two reloads in quick succession would
   * otherwise race, and the slower one wins by arriving last.
   */
  useEffect(() => {
    if (!dep) return;

    let live = true;
    void dailySummary(activeTimezone()).then((r) => {
      if (!live || !r.ok) return;
      setText(r.summary);
      try {
        if (r.summary) localStorage.setItem(cacheKey, r.summary);
        else localStorage.removeItem(cacheKey);
      } catch {
        // Storage refused: the briefing still shows, it just arrives late
        // next time too.
      }
    });
    return () => {
      live = false;
    };
  }, [dep, cacheKey]);

  /*
   * The first arrival of the day, staged on the compositor. The page lays out
   * once with the card in place; the card fades down into it and everything
   * below starts where it was and slides to where it now belongs — transform
   * only, so no frame of the move re-runs layout. Reduced motion: it simply
   * appears.
   */
  useLayoutEffect(() => {
    const el = section.current;
    if (!text || !el || shownAtOpen.current) return;
    shownAtOpen.current = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const ease = 'cubic-bezier(0.2, 0, 0, 1)';
    const shift = el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginBottom || '0');
    el.animate(
      [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: ease },
    );
    // Everything after it on the page, not only its siblings: it is the last
    // thing in the top stack, and the work below is what has to make room.
    for (const next of measureBelow(el).keys()) {
      next.animate([{ transform: `translateY(${-shift}px)` }, { transform: 'none' }], {
        duration: 360,
        easing: ease,
      });
    }
  }, [text]);

  // Whether two lines hold it all; More is offered only when they do not.
  const textRef = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  if (!text) return null;

  /*
   * A sentence, not a card (the iPhone review, 12 Oct 2026). Two lines, and
   * More opens the rest in place only when there is a rest: the briefing is
   * written so its first clause is the suggestion, so two lines carry the
   * point. As a card with a rim and an uppercase MORE it was the loudest
   * thing above the work it was summarising.
   */
  return (
    <section ref={section} aria-label="Briefing">
      <div className="brief" data-open={open || undefined}>
        <p ref={textRef} className="brief-text">
          <Mentioned text={text} mentions={mentions} />
        </p>
        {(clipped || open) && (
          <button
            type="button"
            className="brief-more"
            aria-expanded={open}
            onClick={(e) => {
              const card = e.currentTarget.closest('section');
              if (card) followers.current = measureBelow(card);
              setOpen(!open);
            }}
          >
            {open ? 'Less' : 'More'}
          </button>
        )}
      </div>
    </section>
  );
}

function readBriefing(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** The week's load, the calibration line, and work that keeps being moved. */
export function Ahead({
  assignments,
  deferrals,
  cal,
  sized,
}: {
  assignments: Assignment[];
  deferrals: Record<string, number>;
  cal: ReturnType<typeof calibration>;
  sized: (minutes: number | null) => number | null;
}) {
  const tasks = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: sized(a.effort_minutes),
    status: a.status,
    deferrals: deferrals[a.id] ?? 0,
    weight_percent: a.weight_percent,
  }));

  const ahead = forecast(tasks);
  const stuck = stuckTasks(tasks);

  if (!ahead.warning && stuck.length === 0 && !cal.summary) return null;

  return (
    <section className="flex flex-col gap-3 px-4">
      {ahead.warning && <p className="type-body text-t-approaching">{ahead.warning}</p>}

      {/* Stated as a fact about the estimates, not about the person. It is
          shown here because it is the number that makes the forecast above
          readable: 19 hours of estimates is a different week if they usually
          run to double. */}
      {cal.summary && <p className="type-note text-text-low">{cal.summary}</p>}

      {stuck.map(({ task, note }) => (
        <div key={task.id} className="flex flex-col gap-1">
          <span className="type-body text-text-hi">{task.title}</span>
          <span className="type-note text-text-low">{note}</span>
        </div>
      ))}
    </section>
  );
}

/**
 * Thoughts still to sort. Tapping one opens triage at the shell. Shown only
 * while there is something in it, or for the moment after it was emptied;
 * an empty inbox is not news on a screen about the work.
 */
export function InboxSection({ items, onOpen }: { items: InboxItem[] | null; onOpen: (item: InboxItem) => void }) {
  const inbox = usePresence(items, (e) => e.id, { enter: true });
  // An inbox you emptied is not an inbox you never used. Tracked across this
  // session rather than guessed from a count.
  const had = useRef(false);
  if ((items?.length ?? 0) > 0) had.current = true;
  if (items === null) return null;
  if (!inbox.list.length) {
    return had.current ? <p className="enter-fade mb-8 px-4 type-body text-t-done">Inbox clear.</p> : null;
  }
  return (
    <section className="mb-8" aria-label="Inbox">
      <SectionHead title="Inbox" count={items.length || null} />
      <p className="type-note -mt-2 mb-3 px-4 text-text-low">Tap one to sort it out.</p>
      <div ref={inbox.containerRef}>
        <Card>
          {inbox.list.map(({ item: entry, key, leaving }) => (
            <Pressable
              className="mat-row gap-3 px-4 py-3"
              key={key}
              data-presence={key}
              inert={leaving || undefined}
              onClick={() => onOpen(entry)}
            >
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 self-start rounded-pill bg-text-low" />
              <span className="type-quote text-text-hi">{entry.body}</span>
            </Pressable>
          ))}
        </Card>
      </div>
    </section>
  );
}
