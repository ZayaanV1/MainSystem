import type { ReactNode } from 'react';

/**
 * EmptyState.
 *
 * This app is empty often, and how it behaves when empty decides whether it
 * survives a bad week. So the empty states were designed first rather than
 * last, and the copy rules are strict:
 *
 *   - Neutral or an invitation. Never a lament.
 *   - "Nothing due this week." Full stop. An empty week was not earned, so it
 *     is stated rather than congratulated — but finishing something is a
 *     different matter, and warmth there is welcome.
 *   - "Capture anything here. Sort it later." — an invitation, not a void.
 *   - No emoji. No exclamation marks. No illustration of a person relaxing.
 *   - Never comparative. No streak, no "best week", no chain to break.
 *
 * Empty rings are a starting state, not a deficit.
 */

interface EmptyStateProps {
  /** One plain sentence. Sentence case, ends in a full stop. */
  children: ReactNode;
  /** An optional single action. Rarely needed — most empty states just state. */
  action?: ReactNode;
}

/*
 * Drawn as an empty cell of cloisonné: the wire with no glass in it. A dashed
 * rim says "something goes here" without saying that anything is missing,
 * and it keeps the shape of the list that will fill it, so the screen does
 * not jump when the first thing arrives.
 */
export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className="empty-slot">
      <p className="type-body text-text-mid">{children}</p>
      {action}
    </div>
  );
}
