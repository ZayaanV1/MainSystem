import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Sheet } from '../Sheet';
import { Button } from '../Button';
import { SIZE_NAME, SIZE_ORDER, SIZES, type Widget, type WidgetSize } from '../../lib/board';
import { clampGoal, createGoal, deleteGoal, updateGoal, type Goal } from '../../lib/goals';
import { removePhotos, uploadPhoto } from '../../lib/boardPhotos';
import { addDays, type DayKey } from '../../lib/time';
import { INFO, safeLink, spotifyEmbed } from './catalogue';
import { WidgetFrame } from './WidgetFrame';
import type { WidgetContext } from './widgets';

/**
 * Changing one widget: its size, its face, what it counts down to, which
 * goal it shows, its photo, its link. Opened by tapping a widget while the
 * board is being edited. Every change shows in the preview at once and is
 * saved a moment after typing stops, so a title is not a write per letter.
 */

const SAVE_AFTER_MS = 500;

export function WidgetConfig({
  userId,
  widget,
  board,
  ctx,
  goals,
  onGoalsChange,
  onChange,
  onRemove,
  onClose,
  cell,
}: {
  userId: string;
  widget: Widget;
  board: Widget[];
  ctx: WidgetContext;
  goals: Goal[] | null;
  onGoalsChange: (goals: Goal[]) => void;
  onChange: (w: Widget) => void;
  onRemove: () => void;
  onClose: () => void;
  cell: number;
}) {
  const [w, setW] = useState(widget);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingWidget = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(w);
  latest.current = w;
  const changed = useRef(false);

  // Saved on a pause, and always on the way out.
  const push = (next: Widget, now = false) => {
    setW(next);
    changed.current = true;
    if (pendingWidget.current) clearTimeout(pendingWidget.current);
    if (now) {
      changed.current = false;
      onChange(next);
    } else
      pendingWidget.current = setTimeout(() => {
        changed.current = false;
        onChange(latest.current);
      }, SAVE_AFTER_MS);
  };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () => () => {
      if (pendingWidget.current) clearTimeout(pendingWidget.current);
      if (changed.current) onChangeRef.current(latest.current);
    },
    [],
  );

  const opt = (k: string, v: string, now = false) => push({ ...latest.current, opts: { ...latest.current.opts, [k]: v } }, now);

  /* ------------------------------------------------------------- goals --- */

  const goal = goals?.find((g) => g.id === w.opts.goal) ?? null;
  const [goalDraft, setGoalDraft] = useState<Goal | null>(goal);
  useEffect(() => setGoalDraft(goal), [goal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const goalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGoal = (patch: Partial<Goal>) => {
    if (!goalDraft) return;
    const next = { ...goalDraft, ...patch };
    const counts = clampGoal(next);
    const clean = { ...next, ...counts };
    setGoalDraft(clean);
    onGoalsChange((goals ?? []).map((g) => (g.id === clean.id ? clean : g)));
    if (goalTimer.current) clearTimeout(goalTimer.current);
    goalTimer.current = setTimeout(() => {
      void updateGoal(clean.id, { title: clean.title, unit: clean.unit, have: clean.have, target: clean.target, by_day: clean.by_day }).then(
        ({ error: e }) => e && setError(e),
      );
    }, SAVE_AFTER_MS);
  };
  useEffect(() => () => {
    if (goalTimer.current) clearTimeout(goalTimer.current);
  }, []);

  async function newGoal() {
    setBusy(true);
    const { goal: g, error: e } = await createGoal(userId, { title: 'New goal', unit: '', have: 0, target: 10, by_day: addDays(ctx.today, 21) });
    setBusy(false);
    if (e || !g) return setError(e);
    onGoalsChange([...(goals ?? []), g]);
    opt('goal', g.id, true);
  }

  async function dropGoal() {
    if (!goal) return;
    const { error: e } = await deleteGoal(goal.id);
    if (e) return setError(e);
    onGoalsChange((goals ?? []).filter((g) => g.id !== goal.id));
    opt('goal', '', true);
  }

  /* ------------------------------------------------------------ photos --- */

  async function choosePhoto(file: File) {
    setBusy(true);
    setError(null);
    const { path, error: e } = await uploadPhoto(userId, file);
    setBusy(false);
    if (e || !path) return setError(e);
    const old = latest.current.opts.path;
    opt('path', path, true);
    // The old file is no longer on any widget once this one changes.
    if (old && !board.some((x) => x.id !== w.id && x.opts.path === old)) void removePhotos([old]);
  }

  /* ------------------------------------------------------------ fields --- */

  const sizes = SIZES[w.type];
  const music = w.type === 'music' ? spotifyEmbed(w.opts.url ?? '') : null;
  const link = w.type === 'link' ? safeLink(w.opts.url ?? '') : null;

  return (
    <Sheet open onClose={onClose} title={INFO[w.type].name}>
      <div className="bw-config" style={{ '--cell': `${Math.min(cell, 78)}px`, '--bw-gap': '12px' } as CSSProperties}>
        <div className="bw-pv">
          <WidgetFrame w={w} ctx={ctx} fixed />
        </div>

        <div className="bw-field">
          <span className="type-label">Size</span>
          <div className="bw-chips" role="group" aria-label="Size">
            {SIZE_ORDER.map((s: WidgetSize) => (
              <button key={s} type="button" className="chip" aria-pressed={w.size === s} disabled={!sizes.includes(s)} onClick={() => push({ ...w, size: s }, true)}>
                {SIZE_NAME[s]}
              </button>
            ))}
          </div>
        </div>

        {w.type === 'clock' && (
          <div className="bw-field">
            <span className="type-label">Face</span>
            <div className="bw-chips" role="group" aria-label="Clock face">
              {[['analog', 'Analog'], ['digital', 'Digital'], ['flip', 'Flip'], ['dot', 'Dot matrix']].map(([v, l]) => (
                <button key={v} type="button" className="chip" aria-pressed={(w.opts.face ?? 'analog') === v} onClick={() => opt('face', v, true)}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {w.type === 'count' && (
          <div className="bw-two">
            <label className="bw-field">
              <span className="type-label">What it is</span>
              <input className="well" value={w.opts.title ?? ''} maxLength={60} placeholder="Reading week" onChange={(e) => opt('title', e.target.value)} />
            </label>
            <label className="bw-field">
              <span className="type-label">Date</span>
              <input className="well" type="date" value={w.opts.day ?? ''} onChange={(e) => opt('day', e.target.value as DayKey)} />
            </label>
          </div>
        )}

        {w.type === 'goal' && (
          <>
            <div className="bw-field">
              <span className="type-label">Which goal</span>
              <div className="bw-chips" role="group" aria-label="Goal">
                {goals === null && <span className="type-note">Loading your goals…</span>}
                {(goals ?? []).map((g) => (
                  <button key={g.id} type="button" className="chip" aria-pressed={g.id === w.opts.goal} onClick={() => opt('goal', g.id, true)}>{g.title}</button>
                ))}
                <button type="button" className="chip" disabled={busy || goals === null} onClick={() => void newGoal()}>+ New goal</button>
              </div>
            </div>
            {goalDraft && (
              <>
                <label className="bw-field">
                  <span className="type-label">Name</span>
                  <input className="well" value={goalDraft.title} maxLength={120} onChange={(e) => editGoal({ title: e.target.value })} />
                </label>
                <div className="bw-two">
                  <label className="bw-field">
                    <span className="type-label">Done so far</span>
                    <input className="well" type="number" inputMode="numeric" min={0} value={goalDraft.have} onChange={(e) => editGoal({ have: Number(e.target.value) })} />
                  </label>
                  <label className="bw-field">
                    <span className="type-label">Target</span>
                    <input className="well" type="number" inputMode="numeric" min={1} value={goalDraft.target} onChange={(e) => editGoal({ target: Number(e.target.value) })} />
                  </label>
                </div>
                <div className="bw-two">
                  <label className="bw-field">
                    <span className="type-label">Counting</span>
                    <input className="well" value={goalDraft.unit} maxLength={40} placeholder="chapters" onChange={(e) => editGoal({ unit: e.target.value })} />
                  </label>
                  <label className="bw-field">
                    <span className="type-label">By</span>
                    <input className="well" type="date" value={goalDraft.by_day ?? ''} onChange={(e) => editGoal({ by_day: (e.target.value || null) as DayKey | null })} />
                  </label>
                </div>
                <Button variant="quiet" size="sm" className="bw-danger" onClick={() => void dropGoal()}>Delete this goal</Button>
              </>
            )}
          </>
        )}

        {w.type === 'photo' && (
          <>
            <div className="bw-field">
              <span className="type-label">Picture</span>
              <label className="btn btn-secondary px-3.5 type-label bw-file">
                {busy ? 'Uploading…' : w.opts.path ? 'Choose another photo' : 'Choose a photo'}
                <input className="sr-only" type="file" accept="image/*" disabled={busy} onChange={(e) => e.target.files?.[0] && void choosePhoto(e.target.files[0])} />
              </label>
            </div>
            <label className="bw-field">
              <span className="type-label">Caption, optional</span>
              <input className="well" value={w.opts.caption ?? ''} maxLength={80} onChange={(e) => opt('caption', e.target.value)} />
            </label>
          </>
        )}

        {w.type === 'music' && (
          <label className="bw-field">
            <span className="type-label">Spotify link</span>
            <input className="well" type="url" inputMode="url" value={w.opts.url ?? ''} placeholder="https://open.spotify.com/playlist/…" onChange={(e) => opt('url', e.target.value.trim())} />
            <span className="type-note" data-bad={Boolean(w.opts.url && !music) || undefined}>
              {music ? `Recognised: a ${music.kind}.` : w.opts.url ? 'That isn’t a Spotify link. In Spotify, tap Share, then Copy link.' : 'In Spotify, tap Share, then Copy link.'}
            </span>
          </label>
        )}

        {w.type === 'link' && (
          <div className="bw-two">
            <label className="bw-field">
              <span className="type-label">Name</span>
              <input className="well" value={w.opts.label ?? ''} maxLength={40} placeholder="Course site" onChange={(e) => opt('label', e.target.value)} />
            </label>
            <label className="bw-field">
              <span className="type-label">Address</span>
              <input className="well" type="url" inputMode="url" value={w.opts.url ?? ''} placeholder="https://" onChange={(e) => opt('url', e.target.value.trim())} />
              {w.opts.url && !link && <span className="type-note" data-bad>That isn’t a web address.</span>}
            </label>
          </div>
        )}

        {!['clock', 'count', 'goal', 'photo', 'music', 'link'].includes(w.type) && (
          <p className="type-note bw-ghint">Shows your own planner. Nothing to set up.</p>
        )}

        {error && <p role="alert" className="type-note bw-error">{error}</p>}

        <Button variant="quiet" size="sm" className="bw-danger" onClick={onRemove}>Remove from board</Button>
      </div>
    </Sheet>
  );
}
