import { useState } from 'react';
import { Button } from '../components/Button';
import { SectionHead } from '../components/SectionHead';
import { PopMenu } from '../components/PopMenu';
import { startSession } from '../lib/focus';
import { durationLabel } from '../lib/blocks';
import { addDays, formatDay, formatTime, localDayKey, todayKey } from '../lib/time';
import {
  blockDone,
  blockPin,
  blockRestore,
  blockSkip,
  type AtRisk,
  type PlanBlockRow,
} from '../lib/autoplan';
import type { Assignment, Course } from '../lib/planner';

/**
 * The work plan on Schedule (Autoplan, 6 Nov 2026).
 *
 * The blocks themselves are drawn in the week above, in whichever style is
 * chosen, beside the classes they were fitted around. This section is where
 * they are acted on: the next few with Start, Done, Skip and Pin, what cannot
 * fit before its deadline in minutes, and work left out for having no
 * estimate. Every action here has an undo.
 */

const SHOWN_DAYS = 3;

export function PlanSection({
  userId,
  blocks,
  atRisk,
  unsized,
  disabled,
  error,
  assignments,
  courses,
  onOpenAssignment,
  onSettings,
  onChanged,
  onUndoable,
}: {
  userId: string;
  blocks: PlanBlockRow[];
  atRisk: AtRisk[];
  unsized: number;
  disabled: boolean;
  error: string | null;
  assignments: Assignment[];
  courses: Course[];
  onOpenAssignment: (a: Assignment) => void;
  onSettings: () => void;
  onChanged: () => void;
  onUndoable: (message: string, undo: () => Promise<void>) => void;
}) {
  const [menu, setMenu] = useState<{ block: PlanBlockRow; at: HTMLElement } | null>(null);
  const today = todayKey();
  const work = (id: string) => assignments.find((a) => a.id === id);
  const planned = blocks.filter((b) => b.state === 'planned');
  const total = planned.reduce((s, b) => s + b.minutes, 0);
  const soon = planned.filter((b) => localDayKey(new Date(b.starts_at)) < addDays(today, SHOWN_DAYS));

  async function act(b: PlanBlockRow, what: 'done' | 'skip' | 'pin') {
    const title = work(b.assignment_id)?.title ?? 'work';
    try {
      if (what === 'done') await blockDone(userId, b);
      else if (what === 'skip') await blockSkip(userId, b);
      else await blockPin(userId, b, !b.pinned);
      onUndoable(
        what === 'done' ? `“${title}” block done` : what === 'skip' ? `Skipped; “${title}” gets time elsewhere` : b.pinned ? 'Unpinned' : 'Pinned: this block stays where it is',
        async () => {
          await blockRestore(userId, b);
          onChanged();
        },
      );
      onChanged();
    } catch (e) {
      onUndoable(`Not changed: ${(e as Error).message}`, async () => {});
    }
  }

  if (disabled) {
    return (
      <section className="mb-8">
        <SectionHead title="Plan" />
        <p className="type-note mb-3 px-4 text-text-mid">Automatic planning is off, so no time is set aside for work.</p>
        <div className="px-4">
          <Button size="sm" variant="quiet" onClick={onSettings}>
            Plan settings
          </Button>
        </div>
      </section>
    );
  }

  const nothing = planned.length === 0 && atRisk.length === 0 && unsized === 0;
  if (nothing && !error) return null;

  return (
    <section className="mb-8" aria-labelledby="plan-head">
      <SectionHead title="Plan" count={planned.length || null} />
      <div className="flex flex-col gap-3 px-4">
        <p id="plan-head" className="type-note text-text-mid">
          {planned.length
            ? `${durationLabel(total)} set aside for work over the next two weeks, fitted around your classes and events. It moves itself when they change.`
            : 'No work has time set aside yet.'}
        </p>

        {error && (
          <p role="alert" className="type-note text-text-hi">
            {error}
          </p>
        )}

        {atRisk.map((r) => {
          const a = work(r.assignment_id);
          return (
            <div key={r.assignment_id} className="mat mat-raised flex flex-col gap-1 p-3">
              <p className="kicker">Not enough time</p>
              <p className="type-body text-text-hi">
                {a ? (
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenAssignment(a)}>
                    {r.title}
                  </button>
                ) : (
                  r.title
                )}{' '}
                needs {durationLabel(r.short)} more than is free before {formatDay(localDayKey(new Date(r.due_at)))} {formatTime(new Date(r.due_at))}.
              </p>
              <p className="type-note text-text-low">Free up study hours, take a day off the list, or move the deadline if you can.</p>
            </div>
          );
        })}

        {soon.length > 0 && (
          <div className="mat flex flex-col">
            {soon.map((b) => {
              const a = work(b.assignment_id);
              const start = new Date(b.starts_at);
              const end = new Date(start.getTime() + b.minutes * 60_000);
              const day = localDayKey(start);
              const course = courses.find((c) => c.id === a?.course_id);
              return (
                <div key={b.id} className="mat-row flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block type-label text-text-hi">
                      {day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : formatDay(day)}, {formatTime(start)} – {formatTime(end)}
                      {b.pinned ? ' · pinned' : ''}
                    </span>
                    <span className="block truncate type-note text-text-mid">
                      {a?.title ?? 'Work'}
                      {course ? ` · ${course.code ?? course.name}` : ''}
                    </span>
                    {b.reason && <span className="block type-note text-text-low">{b.reason.replace(/^.*· here because /, 'Here because ')}.</span>}
                  </span>
                  <button
                    type="button"
                    className="bar-round"
                    aria-label={`Options for the ${a?.title ?? 'work'} block`}
                    aria-haspopup="menu"
                    onClick={(e) => setMenu({ block: b, at: e.currentTarget })}
                  >
                    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.9" />
                      <circle cx="12" cy="12" r="1.9" />
                      <circle cx="19" cy="12" r="1.9" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {unsized > 0 && (
          <p className="type-note text-text-low">
            {unsized} {unsized === 1 ? 'piece of work has' : 'pieces of work have'} no estimate, so {unsized === 1 ? 'it is' : 'they are'} not planned. Give one an estimate and it gets time.
          </p>
        )}

        <div>
          <Button size="sm" variant="quiet" onClick={onSettings}>
            Plan settings
          </Button>
        </div>
      </div>

      {menu && (
        <PopMenu label="Block options" anchor={menu.at} onClose={() => setMenu(null)}>
          {(choose) => {
            const b = menu.block;
            const a = work(b.assignment_id);
            return (
              <>
                {a && (
                  <button
                    type="button"
                    role="menuitem"
                    className="pop-item"
                    onClick={() =>
                      choose(() => {
                        startSession(a.id, a.title);
                        onUndoable(`Focus started on “${a.title}”`, async () => {});
                      })
                    }
                  >
                    Start focus
                  </button>
                )}
                <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => void act(b, 'done'))}>
                  Mark done
                </button>
                <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => void act(b, 'skip'))}>
                  Skip, find another time
                </button>
                <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => void act(b, 'pin'))}>
                  {b.pinned ? 'Unpin' : 'Pin here'}
                </button>
                {a && (
                  <button type="button" role="menuitem" className="pop-item" onClick={() => choose(() => onOpenAssignment(a))}>
                    Open the work
                  </button>
                )}
              </>
            );
          }}
        </PopMenu>
      )}
    </section>
  );
}
