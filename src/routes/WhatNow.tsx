import { useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { whatNow, type Task } from '../lib/intelligence';
import type { Assignment, Course } from '../lib/planner';

/**
 * One button, one task.
 *
 * "Decision paralysis in front of a 14-item list is a real failure mode, and a
 * list-based planner can make it worse." So this shows exactly one thing and
 * says why it was chosen — a pick without a reason is indistinguishable from a
 * random one, and gets treated as one.
 *
 * How long you have is asked because it changes the answer, and it is the only
 * question asked: energy would be a second field on the one screen meant to
 * remove decisions, and "what fits the time I have" already covers most of
 * what asking about energy would have been used for.
 *
 * Closing it costs nothing and asking again is allowed. Nothing here is
 * recorded, so there is no way to be judged for pressing it four times.
 */

const WINDOWS = [15, 30, 60, 120] as const;

export function WhatNow({
  assignments,
  courses,
  deferrals,
  onOpen,
}: {
  assignments: Assignment[];
  courses: Course[];
  deferrals: Record<string, number>;
  onOpen: (a: Assignment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);

  if (assignments.length === 0) return null;

  const tasks: Task[] = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    due_at: a.due_at,
    effort_minutes: a.effort_minutes,
    status: a.status,
    deferrals: deferrals[a.id] ?? 0,
  }));

  const choice = open ? whatNow(tasks, { minutesAvailable: minutes }) : null;
  const picked = choice ? assignments.find((a) => a.id === choice.task.id) ?? null : null;

  if (!open) {
    return (
      <div className="mb-8 px-4">
        <Button variant="primary" onClick={() => setOpen(true)}>
          What now?
        </Button>
      </div>
    );
  }

  return (
    <section className="mb-8 px-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="type-label text-text-mid">I have</span>
        {WINDOWS.map((m) => (
          <Chip key={m} selected={minutes === m} onClick={() => setMinutes(minutes === m ? null : m)}>
            {m < 60 ? `${m} min` : `${m / 60} h`}
          </Chip>
        ))}
      </div>

      {choice && picked ? (
        <Card>
          <button
            type="button"
            onClick={() => onOpen(picked)}
            className="flex w-full flex-col items-start gap-2 px-4 py-4 text-left"
          >
            <span className="type-h2 text-text-hi">{picked.title}</span>
            <span className="type-note text-text-low">{choice.because}</span>
            {picked.effort_minutes !== null && (
              <span className="type-caption text-text-low">
                {picked.effort_minutes} min
                {courses.find((c) => c.id === picked.course_id)
                  ? ` · ${courses.find((c) => c.id === picked.course_id)?.code ?? ''}`
                  : ''}
              </span>
            )}
          </button>
        </Card>
      ) : (
        <p className="type-body text-text-mid">Nothing open.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </section>
  );
}
