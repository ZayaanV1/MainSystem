import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AssignmentRow } from '../components/AssignmentRow';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckRow } from '../components/CheckRow';
import { EmptyState } from '../components/EmptyState';
import { ChecklistEditor } from './ChecklistEditor';
import { AssignmentEditor } from './AssignmentEditor';
import type { ChecklistItem } from '../lib/checklist';
import { useAuth } from '../lib/auth';
import { dueOn, recentDays, refillStatus } from '../lib/checklist';
import { describeHealth, fetchHealth, type NotificationHealth } from '../lib/health';
import { subscribeOutbox } from '../lib/outbox';
import {
  BACKFILL_DAYS,
  capture,
  completionKey,
  completionSet,
  loadToday,
  setAssignmentStatus,
  setCompletion,
  type Assignment,
  type TodayData,
} from '../lib/planner';
import { formatDay, todayKey, zoneAbbrev, type DayKey } from '../lib/time';

/**
 * Today — the default view.
 *
 * Opening the app answers "what do I do right now" without navigation, so the
 * order on this screen is the order of the answer: capture first, because a
 * thought you are holding is the most perishable thing here; then the
 * checklist; then everything else.
 *
 * The capture box is always visible and always focusable, and it never asks a
 * second question.
 */
export function Today({
  onOpenSettings,
  onOpenPlan,
  onOpenWeek,
  onData,
}: {
  onOpenSettings: () => void;
  onOpenPlan: () => void;
  onOpenWeek: () => void;
  onData?: (d: TodayData) => void;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const [data, setData] = useState<TodayData | null>(null);
  const [day, setDay] = useState<DayKey>(todayKey());
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [health, setHealth] = useState<NotificationHealth | null>(null);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  const [editing, setEditing] = useState(false);
  const [editorFor, setEditorFor] = useState<{ item: ChecklistItem | null } | null>(null);

  const today = todayKey();
  const reload = useCallback(
    () =>
      loadToday(today).then((d) => {
        setData(d);
        onData?.(d);
      }),
    [today, onData],
  );

  useEffect(() => {
    void reload();
    void fetchHealth().then(setHealth);
  }, [reload]);

  // The dose counter is maintained by a database trigger, so once queued
  // writes have drained the real numbers have to be re-read rather than
  // guessed at locally.
  const wasBusy = useRef(false);
  useEffect(
    () =>
      subscribeOutbox((s) => {
        const busy = s.pending > 0 || s.syncing;
        if (wasBusy.current && !busy) void reload();
        wasBusy.current = busy;
      }),
    [reload],
  );

  const done = completionSet(data?.completions ?? []);
  const items = dueOn(data?.items ?? [], day);
  const status = health ? describeHealth(health) : null;

  const isDone = (itemId: string) => {
    const key = completionKey(itemId, day);
    // An in-flight tap wins over the last fetched state, so the row never
    // flickers back while the write is still in the queue.
    return pendingToggles.has(key) ? !done.has(key) : done.has(key);
  };

  async function toggle(itemId: string) {
    const key = completionKey(itemId, day);
    const next = !isDone(itemId);

    setPendingToggles((p) => new Set(p).add(key));
    await setCompletion(userId, itemId, day, next, today);
  }

  // Clear optimistic state whenever fresh data lands.
  useEffect(() => {
    setPendingToggles(new Set());
  }, [data]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-4 px-4">
        <div>
          <h1 className="type-h1 text-text-hi">Today</h1>
          <p className="type-caption mt-1 text-text-low">
            {formatDay(today)} &middot; {zoneAbbrev()}
          </p>
        </div>
        <div className="flex gap-4">
          <button type="button" onClick={onOpenWeek} className="type-label text-text-mid">
            Week
          </button>
          <button type="button" onClick={onOpenPlan} className="type-label text-text-mid">
            Plan
          </button>
          <button type="button" onClick={onOpenSettings} className="type-label text-text-mid">
            Settings
          </button>
        </div>
      </header>

      <CaptureBox userId={userId} onCaptured={reload} />

      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-4 px-4">
          <h2 className="type-h2 text-text-hi">Checklist</h2>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="type-label text-text-mid"
            >
              Done
            </button>
          ) : (
            <DayStrip today={today} selected={day} onSelect={setDay} />
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState
            action={
              <Button onClick={() => setEditorFor({ item: null })}>Add an item</Button>
            }
          >
            Nothing on the checklist yet.
          </EmptyState>
        ) : (
          <Card>
            {items.map((item) => {
              const refill = refillStatus(item);
              return (
                <CheckRow
                  key={item.id}
                  label={item.title}
                  // In edit mode the row opens its settings instead of
                  // ticking. One tap target per row either way — a second
                  // control beside the checkbox would be a 44px target sitting
                  // next to another 44px target, on a phone, at 7am.
                  done={editing ? false : isDone(item.id)}
                  onToggle={() =>
                    editing ? setEditorFor({ item }) : void toggle(item.id)
                  }
                  meta={
                    editing ? (
                      <span className="text-text-mid">Edit</span>
                    ) : refill.label ? (
                      <span className={refill.needsRefill ? 'text-t-critical' : undefined}>
                        {refill.label}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </Card>
        )}

        <div className="mt-3 flex gap-3 px-4">
          {!editing && items.length > 0 && (
            <Button variant="quiet" onClick={() => setEditing(true)}>
              Edit list
            </Button>
          )}
          {editing && (
            <Button variant="quiet" onClick={() => setEditorFor({ item: null })}>
              Add an item
            </Button>
          )}
        </div>
      </section>

      {openAssignment && (
        <AssignmentEditor
          open
          assignment={openAssignment}
          courses={data?.courses ?? []}
          onClose={() => setOpenAssignment(null)}
          onSaved={reload}
        />
      )}

      {editorFor && (
        <ChecklistEditor
          open
          item={editorFor.item}
          userId={userId}
          nextSortOrder={(data?.items.length ?? 0) + 1}
          onClose={() => setEditorFor(null)}
          onSaved={reload}
        />
      )}

      <section className="mb-8">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Work</h2>
        {!data?.assignments.length ? (
          <EmptyState>Nothing due.</EmptyState>
        ) : (
          <Card>
            {data.assignments.map((a) => (
              <AssignmentRow
                key={a.id}
                assignment={a}
                course={data.courses.find((c) => c.id === a.course_id)}
                onToggleDone={() =>
                  void setAssignmentStatus(a.id, a.status === 'done' ? 'todo' : 'done')
                }
                onOpen={() => setOpenAssignment(a)}
              />
            ))}
          </Card>
        )}
      </section>

      <section className="mb-8 flex-1">
        <h2 className="type-h2 mb-3 px-4 text-text-hi">Inbox</h2>
        {!data?.inbox.length ? (
          <EmptyState>Capture anything here. Sort it later.</EmptyState>
        ) : (
          <Card>
            {data.inbox.map((entry) => (
              <div
                key={entry.id}
                className="border-b border-ink-600 px-4 py-3 last:border-b-0"
              >
                <p className="type-body text-text-hi">{entry.body}</p>
              </div>
            ))}
          </Card>
        )}
      </section>

      {status && (
        <footer className="border-t border-ink-600 px-4 py-4">
          <p className={`type-caption ${status.warn ? 'text-t-critical' : 'text-text-low'}`}>
            {status.text}
          </p>
        </footer>
      )}
    </main>
  );
}

/**
 * Quick capture — the highest-value feature in the app.
 *
 * Submitting clears the field and keeps focus, so three thoughts in a row cost
 * three taps and no navigation. There is no success message: the thought
 * appearing in the inbox below is the confirmation, and a toast would just be
 * something else to dismiss.
 */
function CaptureBox({ userId, onCaptured }: { userId: string; onCaptured: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;

    setText('');
    input.current?.focus();

    await capture(userId, body);
    onCaptured();
  }

  return (
    <form onSubmit={submit} className="mb-8 px-4">
      <label htmlFor="capture" className="sr-only">
        Capture a thought
      </label>
      <input
        id="capture"
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Capture anything"
        autoComplete="off"
        enterKeyHint="done"
        className="w-full rounded-card border border-ink-600 bg-ink-800 px-4 type-body text-text-hi placeholder:text-text-low"
      />
    </form>
  );
}

/**
 * The back-fill strip.
 *
 * Five days, no further. This is the one place the no-streak-shaming rule is
 * easiest to break: a longer window turns into a record of every day missed.
 * Days carry no completion state and no colour — they are a way to reach
 * yesterday, not a report card.
 */
function DayStrip({
  today,
  selected,
  onSelect,
}: {
  today: DayKey;
  selected: DayKey;
  onSelect: (d: DayKey) => void;
}) {
  const days = recentDays(today, BACKFILL_DAYS);

  return (
    <div className="flex gap-1" role="group" aria-label="Choose a day to fill in">
      {days.map((d) => {
        const isToday = d === today;
        const isSelected = d === selected;
        const weekday = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Toronto',
          weekday: 'narrow',
        }).format(new Date(`${d}T12:00:00Z`));

        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={isSelected}
            aria-label={isToday ? `Today, ${formatDay(d)}` : formatDay(d)}
            className={[
              'flex h-9 w-9 flex-col items-center justify-center rounded-pill type-caption',
              'min-h-0',
              isSelected ? 'bg-ink-600 text-text-hi' : 'text-text-low',
            ].join(' ')}
          >
            {/* The weekday letter, with a dot under today. Spelling out
                "Today" does not fit a 36px target, and the dot reads faster
                anyway. No completion state is shown here — this is a way to
                reach yesterday, not a report card. */}
            <span aria-hidden>{weekday}</span>
            {isToday && (
              <span aria-hidden className="mt-0.5 h-1 w-1 rounded-pill bg-current" />
            )}
          </button>
        );
      })}
    </div>
  );
}
