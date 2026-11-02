import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { courseVar, type Assignment, type Course } from '../lib/planner';
import { rowWhen } from '../lib/rowWhen';
import { urgencyFor } from '../lib/urgency';

/**
 * Courses as folders. Each one holds its open work as cards: point at a
 * folder (or tap it, on a phone) and the front leans back while the cards
 * fan up out of it; open it again to go to the course. + adds work to that
 * course, and the new card drops into the folder when it lands.
 *
 * The motion is all CSS (styles/folders.css), driven by one attribute so it
 * stays in step. The only script motion is the drop of a card that was just
 * added, because its end point is wherever the transition has it right now.
 */

/** How many cards a folder shows. Four is what fits the fan without overlap. */
const CARDS = 4;

/* Folder outlines, as fractions of the box, so one shape fits every size. The
   box keeps a fixed 5:4 ratio, which is what keeps the corners round. */
const BACK =
  'M0,0.2054 Q0,0.1161 0.0714,0.1161 L0.3286,0.1161 C0.3714,0.1161 0.3857,0 0.4429,0 L0.9286,0 Q1,0 1,0.0893 L1,0.9107 Q1,1 0.9286,1 L0.0714,1 Q0,1 0,0.9107 Z';
const FRONT =
  'M0,0.1084 Q0,0 0.0643,0 L0.3571,0 C0.4071,0 0.4143,0.0964 0.4714,0.0964 L0.9357,0.0964 Q1,0.0964 1,0.2048 L1,0.8795 Q1,1 0.9286,1 L0.0714,1 Q0,1 0,0.8795 Z';

type State = 'rest' | 'peek' | 'open';

/**
 * The work each folder held when its + was tapped. Whatever turns up in that
 * folder afterwards is what was added, and drops in. Kept outside the
 * component because the screen remounts while the day reloads after a save,
 * and cleared once the drop has played.
 */
const adding = new Map<string, Set<string>>();

export function CourseFolders({
  courses,
  assignments,
  onOpen,
  onOpenWork,
  onAdd,
}: {
  courses: Course[];
  /** Undefined while the day is still loading, so nothing reads as new. */
  assignments: Assignment[] | undefined;
  onOpen: (id: string) => void;
  onOpenWork?: (id: string) => void;
  onAdd?: (courseId: string) => void;
}) {
  // One folder at a time stays open on a tap; a tap anywhere else closes it.
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-fold="${pinned}"]`)) setPinned(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [pinned]);

  const now = new Date();

  return (
    <div className="fold-grid">
      <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
        <clipPath id="fold-back" clipPathUnits="objectBoundingBox">
          <path d={BACK} />
        </clipPath>
        <clipPath id="fold-front" clipPathUnits="objectBoundingBox">
          <path d={FRONT} />
        </clipPath>
      </svg>
      {courses.map((c) => {
        const open = (assignments ?? [])
          .filter((a) => a.course_id === c.id && a.status !== 'done')
          .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
        const next = open[0];
        const due = next?.due_at ? new Date(next.due_at) : null;
        const u = urgencyFor(due, { now });
        const cards = open.slice(0, CARDS);
        return (
          <Folder
            key={c.id}
            course={c}
            // Soonest at the front of the fan, so it is the one read first.
            cards={cards.reverse()}
            openCount={open.length}
            nextWhen={next ? rowWhen(u, due, next.due_has_time, now) : null}
            nextColour={u.colourVar}
            openIds={open.map((a) => a.id)}
            now={now}
            pinned={pinned === c.id}
            onPin={() => setPinned(c.id)}
            onOpen={() => onOpen(c.id)}
            onOpenWork={onOpenWork}
            onAdd={onAdd && (() => onAdd(c.id))}
          />
        );
      })}
    </div>
  );
}

function Folder({
  course,
  cards,
  openCount,
  nextWhen,
  nextColour,
  openIds,
  now,
  pinned,
  onPin,
  onOpen,
  onOpenWork,
  onAdd,
}: {
  course: Course;
  cards: Assignment[];
  openCount: number;
  nextWhen: string | null;
  nextColour: string;
  openIds: string[];
  now: Date;
  pinned: boolean;
  onPin: () => void;
  onOpen: () => void;
  onOpenWork?: (id: string) => void;
  onAdd?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [onPlus, setOnPlus] = useState(false);
  const [focused, setFocused] = useState(false);
  const state: State = pinned || focused ? 'open' : onPlus ? 'peek' : hover ? 'open' : 'rest';

  const cv = courseVar(course.colour_index);
  const n = cards.length;
  const label = course.code ?? course.name;

  function activate() {
    // A pointer that can hover has already opened it; a finger opens it first.
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    if (fine || pinned || focused) onOpen();
    else onPin();
  }

  return (
    <div
      className="fold"
      data-fold={course.id}
      data-state={state}
      style={
        {
          '--b': `var(${cv ?? '--c-0'}-rgb)`,
          '--front-out': `${n * 30}ms`,
        } as CSSProperties
      }
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onClick={(e) => {
        if ((e.target as Element).closest('.fold-card, .fold-add')) return;
        activate();
      }}
    >
      <div className="fold-body">
        <span aria-hidden className="fold-shadow" />
        <div aria-hidden className="fold-back">
          <span className="fold-paint" />
          <svg className="fold-rim" viewBox="0 0 1 1" preserveAspectRatio="none">
            <path d={BACK} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        <div className="fold-cards">
          {cards.map((a, i) => (
            <Card
              key={a.id}
              work={a}
              index={i}
              count={n}
              isNew={adding.get(course.id)?.has(a.id) === false}
              courseId={course.id}
              now={now}
              interactive={state === 'open'}
              onOpen={onOpenWork && (() => onOpenWork(a.id))}
            />
          ))}
        </div>

        <div className="fold-front">
          <span aria-hidden className="fold-paint" />
          <span aria-hidden className="fold-face" />
          <svg aria-hidden className="fold-rim" viewBox="0 0 1 1" preserveAspectRatio="none">
            <path d={FRONT} vectorEffect="non-scaling-stroke" />
          </svg>
          <button
            type="button"
            className="fold-open"
            aria-label={`${label}, ${openCount ? `${openCount} open` : 'nothing open'}. Open the course`}
            onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
          >
            <span className="fold-name">{label}</span>
            <span className="fold-meta">
              <span>{openCount ? `${openCount} open` : 'nothing open'}</span>
              {nextWhen && <span style={{ color: `var(${nextColour})` }}>{nextWhen}</span>}
            </span>
          </button>
          {onAdd && (
            <button
              type="button"
              className="fold-add"
              aria-label={`Add work to ${label}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setOnPlus(true)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setOnPlus(false)}
              onClick={() => {
                adding.set(course.id, new Set(openIds));
                onAdd();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({
  work,
  index,
  count,
  isNew,
  courseId,
  now,
  interactive,
  onOpen,
}: {
  work: Assignment;
  index: number;
  count: number;
  isNew: boolean;
  courseId: string;
  now: Date;
  interactive: boolean;
  onOpen?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Dropped in from above, landing wherever the folder's state has it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!isNew || !el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      adding.delete(courseId);
      return;
    }
    const to = getComputedStyle(el).transform;
    const drop = el.animate(
      [
        { transform: 'translate3d(0, -150%, 0) rotate(-6deg)', opacity: 0 },
        { transform: 'translate3d(0, -150%, 0) rotate(-6deg)', opacity: 1, offset: 0.15 },
        { transform: to === 'none' ? 'none' : to, opacity: 1 },
      ],
      // Held back until the editor's sheet (240 ms out) has cleared the
      // folder, so the drop is seen rather than played underneath it.
      { duration: 620, delay: 220, fill: 'backwards', easing: 'cubic-bezier(0.2, 1.12, 0.32, 1)' },
    );
    drop.onfinish = () => adding.delete(courseId);
    return () => drop.cancel();
  }, [isNew, courseId]);

  // Back of the fan up and to the left, front down and to the right. Folder
  // units, converted to the card's own (it is 72% of the width, 60% of the height).
  const t = count === 1 ? 0.5 : index / (count - 1);
  const dx = (-10 + 30 * t) / 0.72;
  const dy = (-62 + 36 * t) / 0.6;
  const r = -5 + 8 * t;
  const front = index === count - 1;

  const due = work.due_at ? new Date(work.due_at) : null;
  const u = urgencyFor(due, { now });
  const when = rowWhen(u, due, work.due_has_time, now) ?? 'no date';

  return (
    <button
      ref={ref}
      type="button"
      className="fold-card"
      data-art={front ? undefined : true}
      tabIndex={interactive ? 0 : -1}
      aria-hidden={!interactive}
      onClick={onOpen}
      style={
        {
          '--dx': `${dx}%`,
          '--dy': `${dy}%`,
          '--r': `${r}deg`,
          '--in': `${40 + index * 45}ms`,
          '--out': `${(count - 1 - index) * 30}ms`,
          '--fold-angle': `${100 + index * 23}deg`,
        } as CSSProperties
      }
    >
      {!front && <span aria-hidden className="fold-paint" />}
      <span className="fold-card-head">
        <span className="fold-card-title">{work.title || 'Untitled'}</span>
        <span className="fold-card-meta">{when}</span>
      </span>
      {front && (
        <span aria-hidden className="fold-card-lines">
          <span />
          <span />
          <span />
        </span>
      )}
    </button>
  );
}
