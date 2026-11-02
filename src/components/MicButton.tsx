import { useEffect } from 'react';
import { dictationMessage, useDictation } from '../lib/dictation';
import { announce } from '../lib/announce';

/**
 * Speak into a capture field (lib/dictation.ts). Renders nothing where the
 * browser has no recogniser, so no one meets a button that cannot work.
 */
export function MicButton({
  value,
  onText,
  className = '',
  onError,
}: {
  value: string;
  onText: (next: string) => void;
  className?: string;
  /** Where the failure sentence goes; announced as well either way. */
  onError?: (message: string | null) => void;
}) {
  const { supported, listening, error, start, stop } = useDictation(value, onText);

  useEffect(() => {
    const message = dictationMessage(error);
    onError?.(message);
    if (message) announce(message);
  }, [error, onError]);

  if (!supported) return null;
  return (
    <button
      type="button"
      className={`mic-btn ${className}`}
      aria-pressed={listening}
      aria-label={listening ? 'Stop listening' : 'Speak instead of typing'}
      data-listening={listening || undefined}
      onClick={listening ? stop : start}
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}
