import { useRef, useState, type FormEvent } from 'react';
import { dropGhost, flashReceipt } from '../lib/motion';

/**
 * Quick capture — the highest-value feature in the app.
 *
 * Submitting clears the field and keeps focus, so three thoughts in a row cost
 * three taps and no navigation. The receipt under the field is not a toast:
 * nothing to dismiss, it fades by itself. It exists because on a phone the
 * inbox is below the fold, so the thought appearing there was a confirmation
 * nobody could see.
 */
export function CaptureBox({ send }: { send: (body: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const ready = text.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;

    // The words drop out of the field toward the inbox, and a receipt shows
    // under it. On a phone the inbox is below the fold, so seeing the thought
    // land there was a confirmation nobody could see (rule 12).
    if (input.current) dropGhost(input.current, body);
    flashReceipt(receipt.current);
    setText('');
    input.current?.focus();

    // No reload: the optimistic layer puts the thought in the inbox the
    // moment it is on disk. A reload here raced the sync and read the inbox
    // before the write had reached it.
    await send(body);
  }

  return (
    <form onSubmit={submit} className="mb-8 px-4">
      <label htmlFor="capture" className="sr-only">
        Capture a thought
      </label>
      {/*
        The largest field in the app, because it is the one used most and in
        the most hurry. The send button is the round plus at its end: quiet
        while there is nothing to send, ember the moment there is.
      */}
      <div className="well capture-well capture-shell flex items-center gap-1.5 py-1.5 pr-1.5 pl-[1.125rem]">
        <input
          id="capture"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture anything"
          autoComplete="off"
          enterKeyHint="done"
          className="capture-input min-w-0 flex-1 bg-transparent type-body"
        />
        <button
          type="submit"
          aria-label="Add to inbox"
          data-ready={ready || undefined}
          className="btn btn-primary btn-icon capture-send shrink-0"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <p ref={receipt} aria-hidden className="kicker capture-receipt mt-2 pl-[1.125rem] text-accent-2-lit" style={{ opacity: 0 }}>
        Added to inbox
      </p>
    </form>
  );
}
