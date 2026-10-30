import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SKINS, applySkin, type Skin } from '../lib/theme';
import { saveSkin, usePreferences } from '../lib/preferences';
import { sweepFrom } from '../lib/transition';
import { Button } from './Button';
import { clearBackdrop, loadBackdrop, setBackdrop } from '../lib/backdrop';

/**
 * Choosing a theme.
 *
 * Each card holds a real miniature of Today drawn in that theme (the scoped
 * .skin-<name>.mode-<mode> token blocks in tokens.css), not a row of colour
 * swatches: a theme is its material and type as much as its colours, and a
 * swatch cannot show a serif or a square corner.
 *
 * A tap previews the theme across the whole app at once, sweeping out from the
 * card. Keep it saves it to the account; leaving without keeping puts the
 * saved theme back, so trying one on is never a commitment.
 */
export function ThemePicker({ userId }: { userId: string }) {
  const prefs = usePreferences();
  const [preview, setPreview] = useState<Skin | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saved = useRef(prefs.skin);
  saved.current = prefs.skin;
  const mode = useResolvedMode();

  // Leaving Settings while previewing: the saved theme comes back.
  useEffect(() => () => applySkin(saved.current), []);

  const shown = preview ?? prefs.skin;

  function choose(skin: Skin, from: Element) {
    if (skin === shown) return;
    setProblem(null);
    sweepFrom(from, () => {
      applySkin(skin);
      setPreview(skin === prefs.skin ? null : skin);
    });
  }

  async function keep() {
    if (!preview) return;
    const skin = preview;
    setPreview(null);
    const { error } = await saveSkin(userId, skin);
    if (error) setProblem(error);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="theme-cards" role="radiogroup" aria-label="Theme">
        {SKINS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={shown === s.id}
            data-saved={prefs.skin === s.id || undefined}
            className="theme-card"
            onClick={(e) => choose(s.id, e.currentTarget)}
          >
            <span aria-hidden className={`theme-mini skin-${s.id} mode-${mode}`}>
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
            Previewing <b className="text-text-hi">{SKINS.find((s) => s.id === preview)?.name}</b> everywhere
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
                setPreview(null);
              });
            }}
          >
            Back
          </Button>
        </div>
      )}
      {problem && <p className="type-note text-t-overdue">{problem}</p>}
      {shown === 'vision' && <VisionRoom userId={userId} />}
      <p className="type-note text-text-low">The theme follows your account, so your phone and laptop match.</p>
    </div>
  );
}

/**
 * The photo behind Vision: the bundled room at dusk, or one of your own.
 * Shown while Vision is the theme on screen, since it means nothing elsewhere.
 */
function VisionRoom({ userId }: { userId: string }) {
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

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
      <span className="kicker">Vision background</span>
      <p className="type-note text-text-mid">
        {path === undefined ? 'Checking' : path ? 'Your own photo, behind the glass on every device.' : 'A room at dusk, the theme’s own.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a background photo"
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
      {problem && <p className="type-note text-t-overdue">{problem}</p>}
    </div>
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
