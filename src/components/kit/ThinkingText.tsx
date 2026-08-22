/**
 * ThinkingText — the pending state for anything a model is writing.
 *
 * Adapted from KokonutUI's "AI Text Loading": a line of text with a highlight
 * travelling across it, so waiting has a heartbeat rather than a spinner.
 *
 * WHAT CHANGED FROM THEIRS, AND WHY
 *
 * Theirs cycles through playful status lines ("Cooking up something good").
 * Two of this project's rules land on that at once: the copy voice is plain
 * and unexcited, and the model is often being asked what is due — a jokey
 * wait in front of a deadline is the wrong register. The lines here are
 * literal descriptions of the work, and they rotate slowly enough to be read
 * rather than watched.
 *
 * The shimmer is pure CSS on tokenised text colours, so it costs no frame
 * budget and holds no colour value of its own. Under reduced motion the
 * highlight does not travel — the text simply sits there, which is a complete
 * and honest pending state on its own.
 */

import { useEffect, useState } from 'react';

interface ThinkingTextProps {
  /**
   * What is being waited for, in order. Each is shown for `dwell` before the
   * next. The last one stays — running out of lines must not look like the
   * process stopped.
   */
  lines?: string[];
  dwell?: number;
  className?: string;
}

const DEFAULT_LINES = ['Reading your week', 'Working out what matters', 'Writing it up'];

export function ThinkingText({
  lines = DEFAULT_LINES,
  dwell = 2400,
  className = '',
}: ThinkingTextProps) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (i >= lines.length - 1) return;
    const t = setTimeout(() => setI((n) => n + 1), dwell);
    return () => clearTimeout(t);
  }, [i, lines.length, dwell]);

  return (
    <p
      // Polite, not assertive: this is a progress note, and interrupting a
      // screen reader mid-sentence to say "still working" is worse than
      // silence. It announces when the line changes and no more often.
      aria-live="polite"
      className={`type-body shimmer-text ${className}`}
    >
      {lines[Math.min(i, lines.length - 1)]}
    </p>
  );
}
