import { useSyncExternalStore } from 'react';
import { outboxState, subscribeOutbox, type OutboxState } from './outbox';

/**
 * The outbox, as React state.
 *
 * A store subscription rather than an effect that copies state, so the first
 * render already sees what is queued: a screen that opened with three ticks
 * still in the queue must show them ticked from its first frame, not one
 * frame later.
 */
export function useOutbox(): OutboxState {
  return useSyncExternalStore(
    (onChange) => subscribeOutbox(() => onChange()),
    outboxState,
    outboxState,
  );
}
