import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Pressable — a row that is a button.
 *
 * Ten places in this app render a list item whose whole surface is the tap
 * target: an inbox entry to triage, a saved meal to log, a search result to
 * open, a checklist item to edit. Each one had grown its own set of layout
 * classes, and they had already drifted — some were `items-center`, some
 * `items-start`, some `items-baseline`, some had `w-full` and some did not, so
 * a few rows were quietly narrower than the list they sat in.
 *
 * WHY NOT Button
 *
 * Button is a control with a label in the middle of it. This is a surface with
 * content laid out inside it, and the two want opposite things: Button centres,
 * pads inline and stays as narrow as its text; a row fills its container, aligns
 * left, and lets the caller lay out whatever it holds. Forcing one component to
 * do both means a prop that turns off most of the other, which is how a
 * primitive stops being one.
 *
 * What they DO share is the part that must never differ: the 44px floor, the
 * press response, the focus ring, and the disabled treatment. Those live here
 * identically rather than being remembered ten times.
 *
 * The press is `fx-depth` like everything else, so a row answers a finger the
 * same way a button does. On a list this is the only feedback there is — there
 * is no hover on a phone and no label to dim.
 */

type Align = 'center' | 'start' | 'baseline';

interface PressableProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Cross-axis alignment of the row's own children.
   *
   * Three real cases, not a passthrough: `center` for a single line of text,
   * `start` for a row whose content wraps to two lines and should hang from
   * the top, `baseline` for a row that sets a title against a right-aligned
   * value and wants the two sitting on the same line.
   */
  align?: Align;
  children: ReactNode;
}

const ALIGN: Record<Align, string> = {
  center: 'items-center',
  start: 'items-start',
  baseline: 'items-baseline',
};

export function Pressable({
  align = 'center',
  className = '',
  type = 'button',
  children,
  ...rest
}: PressableProps) {
  return (
    <button
      // Same reason as Button: HTML defaults a button inside a form to submit,
      // which silently turned secondary actions into saves. Inert by default.
      type={type}
      {...rest}
      className={[
        // Deliberately no gap and no padding: those genuinely differ per row
        // (a search result is not spaced like a saved meal), and a default
        // here would be silently overridden by callers passing their own,
        // which is undefined behaviour in Tailwind rather than a cascade.
        'flex w-full text-left',
        ALIGN[align],
        // The tap floor is on the row, not on the text inside it, so a row
        // holding one short line is still a full target.
        'min-h-[var(--tap)]',
        'fx-depth',
        'disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
