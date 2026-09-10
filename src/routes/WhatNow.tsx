import { useState } from 'react';
import { Pressable } from '../components/Pressable';
import { Button } from '../components/Button';
import { useMagnetic } from '../lib/useMagnetic';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { whatNow, type Task } from '../lib/intelligence';
import type { Assignment, Course } from '../lib/planner';
import { startSession } from '../lib/focus';

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
    // Without this the tie-break in whatNow can never fire, and the ranking
    // silently ignores everything the syllabus importer worked out.
    weight_percent: a.weight_percent,
  }));

  const magnet = useMagnetic();

  const choice = open ? whatNow(tasks, { minutesAvailable: minutes }) : null;
  const picked = choice ? assignments.find((a) => a.id === choice.task.id) ?? null : null;

  if (!open) {
    return (
      <div className="mb-8 px-4">
        {/*
          The one magnetic control in the app, and the one that earns it: this
          is the button a stuck person presses, and a control that leans toward
          the cursor is a control that looks like it wants to be pressed. The
          offset is capped at 6px inside the hook, so it never moves out from
          under the pointer.
        */}
        <Button variant="primary" className="fx-magnet" {...magnet} onClick={() => setOpen(true)}>
          What now?
        </Button>
      </div>
    );
  }

  return (
    <section className="mb-8 px-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tag type-label">I have</span>
        {WINDOWS.map((m) => (
          <Chip key={m} selected={minutes === m} onClick={() => setMinutes(minutes === m ? null : m)}>
            {m < 60 ? `${m} min` : `${m / 60} h`}
          </Chip>
        ))}
      </div>

      {choice && picked ? (
        <Card>
          <Pressable align="start" className="flex-col gap-2 px-4 py-4"
            onClick={() => onOpen(picked)}>
            <span className="type-h2 text-text-hi">{picked.title}</span>
            <span className="type-note text-text-low">{choice.because}</span>
            {picked.effort_minutes !== null && (
              <span className="tag type-caption">
                {picked.effort_minutes} min
                {courses.find((c) => c.id === picked.course_id)
                  ? ` · ${courses.find((c) => c.id === picked.course_id)?.code ?? ''}`
                  : ''}
              </span>
            )}
          </Pressable>
        </Card>
      ) : (
        <p className="type-body text-text-mid">Nothing open.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        {/*
          Started from here on purpose: this is the exact moment a decision
          becomes work, and it is the only place in the app where the app
          already knows what you are about to do. Asking again on another
          screen would be asking a question that was just answered.
        */}
        {picked && (
          <Button
            variant="primary"
            onClick={() => {
              startSession(picked.id, picked.title);
              setOpen(false);
            }}
          >
            Start on it
          </Button>
        )}
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </section>
  );
}
