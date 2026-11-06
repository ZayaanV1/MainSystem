import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { durationLabel } from '../lib/blocks';
import { formatDay, todayKey } from '../lib/time';
import { loadPlanSettings, savePlanSettings, type PlanSettings } from '../lib/autoplan';

/* ============================================================================
   Plan settings
   ========================================================================= */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT: [number, number] = [9 * 60, 21 * 60];
const CAPS = [60, 120, 180, 240, 300, 360, 480];
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function PlanSettingsSheet({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<PlanSettings | null>(null);
  const [hours, setHours] = useState<Record<string, [number, number] | null>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newOff, setNewOff] = useState('');

  useEffect(() => {
    loadPlanSettings(userId)
      .then((loaded) => {
        setS(loaded);
        const h: Record<string, [number, number] | null> = {};
        for (let d = 1; d <= 7; d++) h[d] = loaded.study_hours ? (loaded.study_hours[d] ?? null) : DEFAULT;
        setHours(h);
      })
      .catch((e: Error) => setProblem(`Could not load the plan settings: ${e.message}`));
  }, [userId]);

  async function save() {
    if (!s) return;
    const study: Record<string, [number, number]> = {};
    for (const [d, v] of Object.entries(hours)) {
      if (!v) continue;
      if (v[1] <= v[0]) {
        setProblem(`${WEEKDAYS[Number(d) - 1]} ends before it starts. Set an end time after the start.`);
        return;
      }
      study[d] = v;
    }
    setSaving(true);
    try {
      await savePlanSettings(userId, { ...s, study_hours: study });
      onSaved();
      onClose();
    } catch (e) {
      setProblem(`Not saved: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open title="Plan settings" onClose={onClose}>
      {!s ? (
        <p className="type-note text-text-mid">{problem ?? 'Loading'}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <label className="mat mat-row flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block type-label text-text-hi">Plan my work automatically</span>
              <span className="block type-note text-text-mid">Sets aside time before each deadline for work with an estimate, and moves it when your calendar changes.</span>
            </span>
            <input type="checkbox" className="settings-switch" checked={s.autoplan} onChange={(e) => setS({ ...s, autoplan: e.target.checked })} />
          </label>

          <section className="flex flex-col gap-2">
            <p className="kicker px-1">Hours work can go in</p>
            <div className="mat flex flex-col">
              {WEEKDAYS.map((name, i) => {
                const d = String(i + 1);
                const v = hours[d];
                return (
                  <div key={d} className="mat-row flex flex-wrap items-center gap-3">
                    <label className="flex min-w-28 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        className="settings-switch"
                        checked={Boolean(v)}
                        onChange={(e) => setHours({ ...hours, [d]: e.target.checked ? DEFAULT : null })}
                      />
                      <span className="type-label text-text-hi">{name}</span>
                    </label>
                    {v ? (
                      <span className="flex items-center gap-2">
                        <input
                          type="time"
                          aria-label={`${name} from`}
                          className="well type-body w-28"
                          value={clock(v[0])}
                          onChange={(e) => e.target.value && setHours({ ...hours, [d]: [minutes(e.target.value), v[1]] })}
                        />
                        <span className="type-note text-text-low">to</span>
                        <input
                          type="time"
                          aria-label={`${name} until`}
                          className="well type-body w-28"
                          value={clock(v[1] >= 1440 ? 1439 : v[1])}
                          onChange={(e) => e.target.value && setHours({ ...hours, [d]: [v[0], minutes(e.target.value)] })}
                        />
                      </span>
                    ) : (
                      <span className="type-note text-text-low">No work planned</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <label className="flex flex-col gap-2">
            <span className="kicker px-1">Most work planned in one day</span>
            <select className="well type-body" value={s.plan_day_cap} onChange={(e) => setS({ ...s, plan_day_cap: Number(e.target.value) })}>
              {[...new Set([...CAPS, s.plan_day_cap])].sort((a, b) => a - b).map((c) => (
                <option key={c} value={c}>
                  {durationLabel(c)}
                </option>
              ))}
            </select>
          </label>

          <section className="flex flex-col gap-2">
            <p className="kicker px-1">Days off</p>
            {s.plan_off_days.filter((d) => d >= todayKey()).length > 0 && (
              <div className="mat flex flex-col">
                {s.plan_off_days
                  .filter((d) => d >= todayKey())
                  .map((d) => (
                    <div key={d} className="mat-row flex items-center gap-3">
                      <span className="flex-1 type-label text-text-hi">{formatDay(d)}</span>
                      <Button size="sm" variant="quiet" onClick={() => setS({ ...s, plan_off_days: s.plan_off_days.filter((x) => x !== d) })}>
                        Remove
                      </Button>
                    </div>
                  ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input type="date" aria-label="A day with no work planned" className="well type-body" min={todayKey()} value={newOff} onChange={(e) => setNewOff(e.target.value)} />
              <Button
                size="sm"
                variant="quiet"
                disabled={!newOff}
                onClick={() => {
                  setS({ ...s, plan_off_days: [...new Set([...s.plan_off_days, newOff])].sort() });
                  setNewOff('');
                }}
              >
                Add day off
              </Button>
            </div>
          </section>

          {problem && (
            <p role="alert" className="type-note text-text-hi">
              {problem}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving' : 'Save'}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
