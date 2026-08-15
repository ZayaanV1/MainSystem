import type { ReactNode } from 'react';

/**
 * EmptyState.
 *
 * This app is empty often, and how it behaves when empty decides whether it
 * survives a bad week. So the empty states were designed first rather than
 * last, and the copy rules are strict:
 *
 *   - Neutral or an invitation. Never praise, never a lament.
 *   - "Nothing due this week." Full stop. Not "great job!" — nothing was
 *     earned, so saying so is a lie the user can feel.
 *   - "Capture anything here. Sort it later." — an invitation, not a void.
 *   - No emoji. No exclamation marks. No illustration of a person relaxing.
 *
 * Empty rings are a starting state, not a deficit.
 */

interface EmptyStateProps {
  /** One plain sentence. Sentence case, ends in a full stop. */
  children: ReactNode;
  /** An optional single action. Rarely needed — most empty states just state. */
  action?: ReactNode;
}

export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-4 px-4 py-8">
      <p className="type-body text-text-mid">{children}</p>
      {action}
    </div>
  );
}
