import { useMemo, useRef, useState, type FormEvent } from 'react';
import { dropGhost, flashReceipt } from '../lib/motion';
import { readCapture, type CourseRef, type QuickRead } from '../lib/quickParse';
import { formatDay, formatTime, localHourMinute, todayKey, wallClockToUTC } from '../lib/time';

/**
 * Quick capture — the highest-value feature in the app.
 *
 * Submitting clears the field and keeps focus, so three thoughts in a row cost
 * three taps and no navigation. The receipt under the field is not a toast:
 * nothing to dismiss, it fades by itself. It exists because on a phone the
 * inbox is below the fold, so the thought appearing there was a confirmation
 * nobody could see.
 *
 * Plain language is read as you type (lib/quickParse.ts, on the device): a
 * thought with a date in it ("lab report thu 5pm phys") shows, under the
 * field, what it will become, and Enter adds it as work. Each part can be
 * tapped away first, and a thought with no date goes to the inbox exactly as
 * it always did. Nothing is written that was not on screen when Enter was
 * pressed (rule 6).
 */
export function CaptureBox({
  send,
  courses = [],
  addWork,
  className = 'mb-8 px-4',
}: {
  send: (body: string) => Promise<unknown>;
  /** Courses a capture can name, by code. */
  courses?: CourseRef[];
  /** Adds a capture read as work, an exam or a presentation. Without it, everything goes to the inbox. */
  addWork?: (read: QuickRead) => Promise<unknown>;
  /** Spacing around the box: Today sets it inside its own stack. */
  className?: string;
}) {
  const [text, setText] = useState('');
  const [without, setWithout] = useState<{ date?: boolean; course?: boolean }>({});
  const [receiptText, setReceiptText] = useState('Added to inbox');
  const input = useRef<HTMLInputElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const ready = text.trim().length > 0;

  const read = useMemo(() => {
    if (!addWork || !text.trim()) return null;
    const { hour, minute } = localHourMinute();
    return readCapture(text, {
      today: todayKey(),
      nowTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      courses,
      without,
    });
  }, [text, courses, without, addWork]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;

    // The words drop out of the field toward the inbox, and a receipt shows
    // under it. On a phone the inbox is below the fold, so seeing the thought
    // land there was a confirmation nobody could see (rule 12).
    if (input.current) dropGhost(input.current, read?.title ?? body);
    setReceiptText(read ? `Added as ${read.kind === 'work' ? 'work' : read.kind === 'exam' ? 'an exam' : 'a presentation'} · ${formatDay(read.day)}` : 'Added to inbox');
    flashReceipt(receipt.current);
    setText('');
    setWithout({});
    input.current?.focus();

    // No reload: the optimistic layer puts the thought in the inbox (or the
    // work in its group) the moment it is on disk. A reload here raced the
    // sync and read before the write had reached it.
    if (read && addWork) await addWork(read);
    else await send(body);
  }

  return (
    <form onSubmit={submit} className={`relative ${className}`}>
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
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) setWithout({});
          }}
          placeholder="Capture anything"
          autoComplete="off"
          enterKeyHint="done"
          aria-describedby={read ? 'capture-read' : undefined}
          className="capture-input min-w-0 flex-1 bg-transparent type-body"
        />
        <button
          type="submit"
          aria-label={read ? 'Add as work' : 'Add to inbox'}
          data-ready={ready || undefined}
          className="btn btn-icon capture-send shrink-0"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {read ? (
        <div id="capture-read" className="capture-read enter-fade" aria-live="polite">
          <span className="capture-read-label">
            {read.kind === 'work' ? 'Adds as work' : read.kind === 'exam' ? 'Adds as an exam' : 'Adds as a presentation'}
          </span>
          {/* The title it will be saved under, since reading a date takes words
              out of what was typed. What was typed is kept in its notes. */}
          <span className="capture-read-title">{read.title}</span>
          <button
            type="button"
            className="capture-part hit-expand"
            aria-label={`Due ${dayLabel(read)}. Remove the date and send it to the inbox instead`}
            onClick={() => setWithout((w) => ({ ...w, date: true }))}
          >
            {dayLabel(read)}
            <Cross />
          </button>
          {read.course && (
            <button
              type="button"
              className="capture-part hit-expand"
              aria-label={`In ${read.course.code ?? read.course.name}. Remove the course`}
              onClick={() => setWithout((w) => ({ ...w, course: true }))}
            >
              {read.course.code ?? read.course.name}
              <Cross />
            </button>
          )}
        </div>
      ) : without.date && text.trim() ? (
        <div className="capture-read enter-fade">
          <span className="capture-read-label">Goes to the inbox</span>
          <button type="button" className="capture-part capture-part-quiet hit-expand" onClick={() => setWithout((w) => ({ ...w, date: false }))}>
            Read the date again
          </button>
        </div>
      ) : null}

      <p ref={receipt} aria-hidden className="kicker capture-receipt pl-[1.125rem] text-accent-2-lit" style={{ opacity: 0 }}>
        {receiptText}
      </p>
    </form>
  );
}

/** "Thu, Oct 15 · 5:00 p.m.", or the day alone when no time was given. */
function dayLabel(r: QuickRead): string {
  if (!r.time) return formatDay(r.day);
  const [h, m] = r.time.split(':').map(Number);
  return `${formatDay(r.day)} · ${formatTime(wallClockToUTC(r.day, h, m))}`;
}

function Cross() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
