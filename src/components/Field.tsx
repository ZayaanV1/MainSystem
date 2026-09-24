import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Field.
 *
 * A labelled text input. The label is always present and always visible —
 * placeholder-as-label disappears the moment you start typing, which is
 * exactly when you are most likely to have lost track of what the box wanted.
 *
 * `hint` and `error` occupy the same slot so the layout does not jump when a
 * validation message appears. Error text says what happened and what to do,
 * and does not apologise.
 */

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Field({ label, hint, error, className = '', ...rest }: FieldProps) {
  const id = useId();
  const describedBy = `${id}-note`;

  return (
    <div className="flex flex-col gap-2">
      {/* A tracked label above the well. It was an action-chip — a
          full-width pill — which read exactly like a button, so every form
          in the app looked like a stack of buttons with boxes under them. */}
      <label htmlFor={id} className="kicker">
        {label}
      </label>

      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? describedBy : undefined}
        // A recessed well that lights in ember when it has focus. The error
        // state is the well's own aria-invalid rule, so it cannot drift from
        // what a screen reader is told.
        className={['well type-body', className].join(' ')}
      />

      {(hint || error) && (
        <p
          id={describedBy}
          className={`type-note ${error ? 'text-t-overdue' : 'text-text-low'}`}
          // Announced when it changes, so an error is not silent for a screen
          // reader that has already moved past the field.
          role={error ? 'alert' : undefined}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
