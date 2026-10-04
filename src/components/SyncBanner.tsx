import { useState } from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { Sheet, SheetPresence } from './Sheet';
import { describeWrite, discardFailed, retryFailed, retryNow, type FailedEntry } from '../lib/outbox';
import { useOutbox } from '../lib/useOutbox';
import { formatDay, formatTime, localDayKey } from '../lib/time';

/**
 * The sync banner.
 *
 * Rule 5: never silently lose data. Queued writes are invisible by design —
 * that is the point of optimistic UI — so the moments they must become
 * visible are when they stop going through, and when the server refuses one.
 *
 * It had no buttons. A write that could never succeed sat at the head of the
 * queue with "Couldn't sync" above it and no way to retry, discard or even see
 * what it was. Now a refused change is named in the words of whoever made it
 * ("Ticking an item for Thu 2 Oct"), with why, and with Try again and Discard;
 * and a transient failure gets Retry now instead of waiting for the next
 * time the app happens to come to the front.
 */
export function SyncBanner() {
  const state = useOutbox();
  const [reviewing, setReviewing] = useState(false);

  const stalled = state.pending > 0 && !state.syncing;
  const failed = state.failed;
  if (!state.error && !stalled && failed.length === 0) return null;

  const waiting = `${state.pending} change${state.pending === 1 ? '' : 's'} waiting.`;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <>
      <div role="status" className="flex flex-col gap-2 border-b border-ink-600 bg-ink-700 px-4 py-3">
        {(state.error || stalled) && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className={`type-note ${state.error ? 'text-t-critical' : 'text-text-mid'}`}>
              {state.error ? `${state.error} ${waiting}` : offline ? `Offline. ${waiting}` : waiting}
            </p>
            {!offline && (
              <Button variant="quiet" size="sm" onClick={() => void retryNow()}>
                Retry now
              </Button>
            )}
          </div>
        )}

        {failed.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="type-note text-t-critical">
              {failed.length === 1
                ? 'One change could not be saved.'
                : `${failed.length} changes could not be saved.`}
            </p>
            <Button variant="quiet" size="sm" onClick={() => setReviewing(true)}>
              Review
            </Button>
          </div>
        )}
      </div>

      <SheetPresence>
      {reviewing && (
        <Sheet open dock onClose={() => setReviewing(false)} title="Changes not saved">
          <FailedList failed={failed} onEmpty={() => setReviewing(false)} />
        </Sheet>
      )}
      </SheetPresence>
    </>
  );
}

function FailedList({ failed, onEmpty }: { failed: FailedEntry[]; onEmpty: () => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (failed.length === 0) {
    return <p className="type-body text-text-mid">Everything is saved.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="type-body text-text-mid">
        The server refused these. Each is kept here until you try it again or let it go.
      </p>

      {failed.length > 1 && (
        <div>
          <Button variant="secondary" onClick={() => void retryFailed().then(onEmpty)}>
            Try all again
          </Button>
        </div>
      )}

      <Card>
        {failed.map((f) => (
          <div key={f.id} className="mat-row flex flex-col gap-2 px-4 py-3.5">
            <span className="type-body text-text-hi">{describeWrite(f)}</span>
            <span className="type-note text-text-mid">{f.reason}</span>
            <span className="type-note text-text-low">
              Made {formatDay(localDayKey(new Date(f.createdAt)))} at {formatTime(new Date(f.createdAt))}
            </span>
            <div className="mt-1 flex flex-wrap gap-2">
              {confirming === f.id ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => void discardFailed(f.id)}>
                    Discard for good
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setConfirming(null)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="quiet" size="sm" onClick={() => void retryFailed([f.id])}>
                    Try again
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setConfirming(f.id)}>
                    Discard
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
