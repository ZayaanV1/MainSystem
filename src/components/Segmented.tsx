import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { followCapsule, moveCapsule } from '../lib/motion';

/**
 * A segmented switch: two to four options, one ember capsule sliding between
 * them, the same object as the tab bar's and Week's style picker.
 *
 * A radiogroup, so the arrow keys move it, which is what a screen reader has
 * been told to expect by the role. `fill` stretches it to its container with
 * equal options, for a switch that heads a form.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  fill = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  fill?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const lit = useRef<HTMLSpanElement>(null);
  const seg = useRef<HTMLDivElement>(null);
  const index = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    if (lit.current) moveCapsule(lit.current, refs.current[index] ?? null, 'x');
    if (!seg.current) return;
    return followCapsule(seg.current, () => {
      if (lit.current) moveCapsule(lit.current, refs.current[index] ?? null, 'x', { instant: true });
    });
  }, [index]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div ref={seg} role="radiogroup" aria-label={label} className="style-seg" data-fill={fill || undefined}>
      <span ref={lit} aria-hidden className="style-opt-lit" style={{ opacity: 0 }} />
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            type="button"
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className="style-opt"
          >
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
