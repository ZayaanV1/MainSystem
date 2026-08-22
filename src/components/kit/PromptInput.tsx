/**
 * PromptInput — the composer for Abood.
 *
 * Adapted from KokonutUI's "AI Input Search": the field and its submit share
 * one bordered surface, the control is an arrow rather than a word, and the
 * box grows with the text instead of scrolling a single line.
 *
 * WHAT WAS DELIBERATELY NOT TAKEN FROM IT
 *
 * Their version animates a placeholder that types itself and cycles through
 * suggestions. On a screen whose whole job is to take a question out of your
 * head, a placeholder that rewrites itself while you are deciding what to ask
 * is friction wearing the costume of delight — you end up reading the field
 * instead of using it. The placeholder here is one fixed sentence.
 *
 * THE KEYBOARD RULE
 *
 * The textarea is never remounted and never keyed on anything that changes.
 * A remount while the on-screen keyboard is up drops focus, the keyboard
 * closes, and on a phone that reads as the app fighting you — which is the
 * failure reported on this app once already. Height is written to the node
 * directly rather than driven through React state for the same reason: state
 * that changes on every keystroke is the shape of bug that causes it.
 */

import { useLayoutEffect, useRef } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Button } from '../Button';

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Blocks submit and dims the arrow. The field itself stays editable. */
  busy?: boolean;
  /** Replaces the composer entirely — for the daily budget being spent. */
  disabledReason?: string;
  label: string;
  /** Rows of text before the box stops growing and starts scrolling. */
  maxRows?: number;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask Abood anything',
  busy = false,
  disabledReason,
  label,
  maxRows = 6,
}: PromptInputProps) {
  const field = useRef<HTMLTextAreaElement>(null);

  // Height follows content, capped. Written before paint so the box never
  // shows at the wrong size for a frame.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const padding = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows) + padding}px`;
  }, [value, maxRows]);

  const ready = value.trim().length > 0 && !busy;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!ready) return;
    onSubmit();
  }

  /**
   * Enter sends, Shift+Enter breaks the line.
   *
   * Except while an IME composition is open, where Enter is committing a
   * character rather than finishing a sentence — sending there would mail a
   * half-typed word, and it is the standard way this control is got wrong.
   */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  }

  if (disabledReason) {
    return (
      <div className="rounded-card border border-ink-600 bg-ink-800 px-4 py-3">
        <p className="type-note text-text-mid">{disabledReason}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="prompt-shell flex items-end gap-2 rounded-card border border-ink-600 bg-ink-800 py-2 pr-2 pl-4"
    >
      <textarea
        ref={field}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        className="type-body max-h-none flex-1 resize-none self-center bg-transparent py-2 text-text-hi outline-none placeholder:text-text-low"
      />

      {/*
        An arrow, not the word. It sits at the end of a field where "send" is
        the only thing the control could mean, and a glyph reads faster than a
        word you have to finish reading. The accessible name still says it.
      */}
      <Button
        type="submit"
        variant="primary"
        disabled={!ready}
        aria-label="Send"
        className="grid size-9 shrink-0 place-items-center rounded-pill px-0"
      >
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Button>
    </form>
  );
}
