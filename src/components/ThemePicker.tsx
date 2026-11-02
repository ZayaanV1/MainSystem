import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LOOKS, SKINS, applyLook, applySkin, type Look, type Skin } from '../lib/theme';
import { saveLook, saveSkin, usePreferences } from '../lib/preferences';
import { sweepFrom } from '../lib/transition';
import { Button } from './Button';
import { Chip } from './Chip';
import { clearBackdrop, loadBackdrop, setBackdrop } from '../lib/backdrop';
import { GLASS_PRESETS, setAppearance, useAppearance } from '../lib/appearance';

/**
 * Choosing a theme, a colour scheme and a wallpaper.
 *
 * Three separate choices since 2 Nov 2026. The theme is the material (Glass,
 * Dot matrix or Plain), the colour scheme is the palette and type, and any
 * theme takes any scheme. The wallpaper is what sits behind the glass.
 *
 * Each card holds a real miniature of Today drawn in that combination (the
 * scoped .skin-<name>.look-<name>.mode-<mode> blocks), not a row of swatches:
 * a scheme is its type as much as its colours, and a theme its material.
 *
 * A tap previews across the whole app at once, sweeping out from the card.
 * Keep it saves to the account; leaving without keeping puts the saved
 * choice back, so trying one on is never a commitment.
 */
export function ThemePicker({ userId }: { userId: string }) {
  const prefs = usePreferences();
  const [preview, setPreview] = useState<{ skin: Skin; look: Look } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saved = useRef({ skin: prefs.skin, look: prefs.look });
  saved.current = { skin: prefs.skin, look: prefs.look };
  const mode = useResolvedMode();

  // Leaving Settings while previewing: the saved choice comes back.
  useEffect(
    () => () => {
      applySkin(saved.current.skin);
      applyLook(saved.current.look);
    },
    [],
  );

  const shown = preview ?? { skin: prefs.skin, look: prefs.look };

  function choose(next: { skin: Skin; look: Look }, from: Element) {
    if (next.skin === shown.skin && next.look === shown.look) return;
    setProblem(null);
    sweepFrom(from, () => {
      applySkin(next.skin);
      applyLook(next.look);
      setPreview(next.skin === prefs.skin && next.look === prefs.look ? null : next);
    });
  }

  async function keep() {
    if (!preview) return;
    const next = preview;
    setPreview(null);
    const results = await Promise.all([
      next.skin !== prefs.skin ? saveSkin(userId, next.skin) : null,
      next.look !== prefs.look ? saveLook(userId, next.look) : null,
    ]);
    const error = results.find((r) => r?.error)?.error;
    if (error) setProblem(error);
  }

  const previewName = preview
    ? [
        preview.look !== prefs.look ? LOOKS.find((l) => l.id === preview.look)?.name : null,
        preview.skin !== prefs.skin ? SKINS.find((s) => s.id === preview.skin)?.name : null,
      ]
        .filter(Boolean)
        .join(' in ')
    : '';

  return (
    <div className="flex flex-col gap-3">
      <p className="kicker">Theme</p>
      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={shown.look === l.id}
            data-saved={prefs.look === l.id || undefined}
            className="theme-card"
            onClick={(e) => choose({ skin: shown.skin, look: l.id }, e.currentTarget)}
          >
            <span aria-hidden className={`theme-mini skin-${shown.skin} look-${l.id} mode-${mode}`}>
              <MiniToday />
            </span>
            <span className="theme-card-name">{l.name}</span>
            <span className="type-note text-text-low">{l.line}</span>
          </button>
        ))}
      </div>

      <p className="kicker mt-4">Colour scheme</p>
      <div className="theme-cards" role="radiogroup" aria-label="Colour scheme">
        {SKINS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={shown.skin === s.id}
            data-saved={prefs.skin === s.id || undefined}
            className="theme-card"
            onClick={(e) => choose({ skin: s.id, look: shown.look }, e.currentTarget)}
          >
            <span aria-hidden className={`theme-mini skin-${s.id} look-${shown.look} mode-${mode}`}>
              <MiniToday />
            </span>
            <span className="kicker">{s.reference}</span>
            <span className="theme-card-name">{s.name}</span>
            <span className="type-note text-text-low">{s.line}</span>
          </button>
        ))}
      </div>

      {preview && (
        <div className="theme-preview-bar enter-fade" role="status">
          <span className="min-w-0 flex-1 type-note text-text-mid">
            Previewing <b className="text-text-hi">{previewName}</b> everywhere
          </span>
          <Button variant="primary" size="sm" onClick={() => void keep()}>
            Keep it
          </Button>
          <Button
            variant="quiet"
            size="sm"
            onClick={(e) => {
              const from = e.currentTarget;
              sweepFrom(from, () => {
                applySkin(prefs.skin);
                applyLook(prefs.look);
                setPreview(null);
              });
            }}
          >
            Back
          </Button>
        </div>
      )}
      {problem && <p className="type-note text-t-overdue">{problem}</p>}
      <p className="type-note text-text-low">The theme and colour scheme follow your account, so your phone and laptop match.</p>

      <p className="kicker mt-4">Wallpaper</p>
      <Wallpaper userId={userId} glass={shown.look === 'glass'} />
      {shown.look === 'glass' && <GlassSettings />}
    </div>
  );
}

/**
 * The wallpaper behind the glass: the bundled room at dusk or the account's
 * own photo, which follows the account. Only Glass draws one, so under the
 * other themes it is kept and says so rather than disappearing.
 */
function Wallpaper({ userId, glass }: { userId: string; glass: boolean }) {
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const look = useAppearance();

  useEffect(() => {
    void loadBackdrop().then(setPath);
  }, []);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    const r = await setBackdrop(userId, file, path ?? null);
    setBusy(false);
    if (r.error) setProblem(r.error);
    else setPath(r.path);
  }

  async function reset() {
    setBusy(true);
    setProblem(null);
    const r = await clearBackdrop(userId, path ?? null);
    setBusy(false);
    if (r.error) setProblem(r.error);
    else setPath(null);
  }

  return (
    <div className="mat flex flex-col gap-2 p-4">
      <div role="radiogroup" aria-label="Wallpaper" className="flex flex-wrap gap-2">
        {(['photo', 'off'] as const).map((v) => (
          <Chip
            key={v}
            role="radio"
            aria-checked={look.visionBackground === v}
            selected={look.visionBackground === v}
            onClick={() => setAppearance({ visionBackground: v })}
          >
            {v === 'photo' ? 'Photo' : 'No wallpaper'}
          </Chip>
        ))}
      </div>
      <p className="type-note text-text-mid">
        {path === undefined ? 'Checking' : path ? 'Your own photo, on every device.' : 'A room at dusk, the default.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a wallpaper photo"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Saving' : path ? 'Change photo' : 'Use my own photo'}
        </Button>
        {path && (
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void reset()}>
            Use the default
          </Button>
        )}
      </div>
      {!glass && <p className="type-note text-text-low">The wallpaper shows behind the Glass theme. It is kept while you use another.</p>}
      {problem && <p className="type-note text-t-overdue">{problem}</p>}
    </div>
  );
}

/**
 * The Glass theme's own settings: the glass itself and the desk. Per device,
 * because how clear and how frosted the glass can be is this device's GPU's
 * say. Every change shows at once behind this panel.
 */
function GlassSettings() {
  const look = useAppearance();

  return (
    <div className="mat flex flex-col gap-2 p-4">
      <span className="kicker">Glass</span>
      <div role="radiogroup" aria-label="Glass" className="flex flex-wrap gap-2">
        {(['frost', 'smoke'] as const).map((g) => (
          <Chip
            key={g}
            role="radio"
            aria-checked={look.visionGlass === g}
            selected={look.visionGlass === g}
            onClick={() => setAppearance({ visionGlass: g, ...GLASS_PRESETS[g] })}
          >
            {g === 'frost' ? 'Frost' : 'Smoke'}
          </Chip>
        ))}
      </div>
      <p className="type-note text-text-low">
        {look.visionGlass === 'smoke' ? 'Darker, warmer glass.' : 'Light, frosty glass.'} The sliders below still move freely.
      </p>
      <Slider
        label="See-through"
        value={look.visionClear}
        max={100}
        step={5}
        shown={`${look.visionClear}%`}
        ends={['Solid', 'Clear']}
        onChange={(v) => setAppearance({ visionClear: v })}
      />
      <Slider
        label="Blur"
        value={look.visionBlur}
        max={40}
        step={2}
        shown={look.visionBlur ? `${look.visionBlur} px` : 'Off'}
        ends={['None', 'Heavy']}
        onChange={(v) => setAppearance({ visionBlur: v })}
      />
      <Slider
        label="Dim the wallpaper"
        value={look.visionDim}
        max={100}
        step={5}
        shown={`${look.visionDim}%`}
        ends={['Bright', 'Dark']}
        disabled={look.visionBackground === 'off'}
        onChange={(v) => setAppearance({ visionDim: v })}
      />
      <div role="radiogroup" aria-label="Navigation on a laptop" className="flex flex-wrap gap-2">
        {(['floating', 'full'] as const).map((d) => (
          <Chip key={d} role="radio" aria-checked={look.visionDock === d} selected={look.visionDock === d} onClick={() => setAppearance({ visionDock: d })}>
            {d === 'floating' ? 'Floating dock' : 'Full-height sidebar'}
          </Chip>
        ))}
      </div>
      <label className="flex min-h-[var(--tap)] items-center justify-between gap-4">
        <span className="type-label text-text-hi">Cards lift under the mouse</span>
        <input
          type="checkbox"
          className="settings-switch"
          checked={look.visionLift}
          onChange={(e) => setAppearance({ visionLift: e.target.checked })}
        />
      </label>
      <p className="type-note text-text-low">
        The clearer the glass, the more the wallpaper dims behind it, so text always stays readable. These are
        remembered on this device.
      </p>
    </div>
  );
}

function Slider({
  label,
  value,
  max,
  step,
  shown,
  ends,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  shown: string;
  ends: [string, string];
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className={`v-slider ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="type-label text-text-hi">{label}</span>
        <span className="type-note text-text-mid">{shown}</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span aria-hidden className="flex justify-between type-note text-text-low">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </span>
    </label>
  );
}

/** Light or dark as currently shown, so each miniature is drawn in the same mode. */
function useResolvedMode(): 'dark' | 'light' {
  const read = (): 'dark' | 'light' => {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const update = () => setMode(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', update);
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);
  return mode;
}

/**
 * The top of Today, in miniature, built from the app's own pieces so each
 * theme's material and type show exactly as they would on the screen.
 */
function MiniToday() {
  return (
    <span className="theme-mini-page">
      <span className="theme-mini-mast">
        <span className="type-masthead">Monday</span>
        <span className="today-date">Oct 12</span>
      </span>
      <span className="theme-mini-pills">
        <span className="tick-pill">
          <span className="tick" data-done />
          Medication
        </span>
        <span className="tick-pill">
          <span className="tick" />
          Plan tomorrow
        </span>
      </span>
      <span className="mat slip slip-ticket theme-mini-slip" data-block style={{ '--b': 'var(--c-5-rgb)' } as CSSProperties}>
        <span className="stub" style={{ color: 'var(--t-critical)' }}>
          <span className="stub-n stub-time">3:00</span>
          <span className="stub-u">p.m.</span>
        </span>
        <span className="tk-body">
          <span className="slip-title text-text-hi">Problem set 4</span>
          <span className="tk-meta">PHYS 205 · 45 min</span>
        </span>
        <span className="tk-side">
          <span className="tk-done">
            <span className="tick" />
          </span>
        </span>
      </span>
      <span className="theme-mini-actions">
        <span className="btn btn-primary">Capture</span>
        <span className="btn btn-secondary">What now?</span>
      </span>
    </span>
  );
}
