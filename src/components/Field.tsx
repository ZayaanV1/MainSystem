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
      <label htmlFor={id} className="action-chip type-label">
        {label}
      </label>

      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? describedBy : undefined}
        className={[
          'w-full rounded-card border bg-ink-800 px-4 type-body text-text-hi',
          'placeholder:text-text-low',
          error ? 'border-t-overdue' : 'border-ink-600',
          className,
        ].join(' ')}
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
