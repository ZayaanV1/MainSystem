import { Button } from './Button';

/**
 * LoadFailure — the state the app was missing entirely.
 *
 * Every read in this app used to end in `data ?? []`. Supabase returns
 * `{ data: null, error }` when a query fails, so a dropped connection, a 5xx,
 * a rate limit and an RLS denial all arrived as an empty array — and Today
 * rendered "Nothing due." The app confidently reported a clear day whenever it
 * had failed to look at the day.
 *
 * That is the worst failure this codebase can have. Rule 1 says opening the
 * app answers "what do I do right now"; the spec says a confidently wrong
 * deadline is worse than no answer. An empty screen that is indistinguishable
 * from a real empty screen is a wrong answer delivered with total confidence,
 * and the user has no way to tell.
 *
 * So this is deliberately NOT a full-screen error page. Whatever DID load is
 * still worth seeing — if your work loaded and only the inbox failed, hiding
 * your work behind an error would be its own kind of lying. This sits above
 * the content and says precisely which parts are missing.
 *
 * The copy follows the voice: says what happened, says what to do, does not
 * apologise, and does not blame the reader's connection when it does not know
 * that is the cause.
 */

interface LoadFailureProps {
  /** What did not load, in the user's words. Empty renders nothing. */
  failed: string[];
  onRetry: () => void;
  /** Set while the retry is in flight, so the button cannot be stacked. */
  retrying?: boolean;
}

export function LoadFailure({ failed, onRetry, retrying = false }: LoadFailureProps) {
  if (failed.length === 0) return null;

  const list =
    failed.length === 1
      ? failed[0]
      : `${failed.slice(0, -1).join(', ')} and ${failed[failed.length - 1]}`;

  return (
    <div
      // Assertive, not polite. This is the one message in the app that changes
      // what the rest of the screen MEANS — a reader who misses it will read
      // an incomplete day as a complete one.
      role="alert"
      className="mx-4 mb-4 flex flex-col gap-3 rounded-card border border-t-critical/40 bg-ink-800 px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <p className="type-label text-text-hi">
          {failed.length === 1 ? "Couldn't load " : "Couldn't load "}
          {list}.
        </p>
        {/*
          The important sentence. Without it the user assumes the screen is
          complete, which is the whole bug this component exists to fix.
        */}
        <p className="type-note text-text-mid">
          What you can see below is incomplete. Nothing has been lost — this is
          a reading problem, not a saving one.
        </p>
      </div>

      <div>
        <Button variant="quiet" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying' : 'Retry'}
        </Button>
      </div>
    </div>
  );
}
