import { Button } from './Button';
import { Sheet } from './Sheet';
import { setActualMinutes } from '../lib/planner';

/**
 * What the timer measured, offered once.
 *
 * OFFERED, NOT WRITTEN. This is the same rule the existing chip row follows:
 * "actual time is never demanded", because asking as a required step puts
 * friction on the one action that has to stay free, and a number given to
 * dismiss a prompt is not worth calibrating on.
 *
 * A timer changes the calculation slightly — this number was MEASURED rather
 * than recalled, so it is worth more to the median than a guess typed a day
 * later. That is an argument for offering it clearly, not for writing it
 * silently. Silently recording would make starting a timer a commitment, and
 * the moment starting one costs something, nobody starts one.
 *
 * THE ROUNDING IS OFFERED TOO
 *
 * A session almost never ends at a round number, and a person's honest answer
 * to "how long did that take" is usually rounder than the clock's. So the
 * measured figure leads and two neighbouring round values sit beside it —
 * because 47 minutes of clock time that included finding a pen is genuinely
 * "about 45", and forcing the precise number would record a precision the
 * session did not have.
 */

interface FocusResultProps {
  assignmentId: string;
  title: string;
  minutes: number;
  onDone: () => void;
}

/** The measured value, plus the nearest sensible roundings, without duplicates. */
function options(minutes: number): number[] {
  const candidates = [minutes, Math.round(minutes / 5) * 5, Math.round(minutes / 15) * 15];
  return [...new Set(candidates.filter((n) => n > 0))].sort((a, b) => a - b);
}

export function FocusResult({ assignmentId, title, minutes, onDone }: FocusResultProps) {
  const choices = options(minutes);

  return (
    <Sheet open onClose={onDone} title="That session">
      <div className="flex flex-col gap-4">
        <p className="type-body text-text-mid">
          {minutes === 0
            ? `Under a minute on ${title}.`
            : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} on ${title}.`}
        </p>

        {minutes > 0 && (
          <>
            <p className="type-note text-text-low">
              Recording it improves what the app estimates next time. Skipping
              costs nothing.
            </p>

            <div className="flex flex-wrap gap-2">
              {choices.map((n) => (
                <Button
                  key={n}
                  variant={n === minutes ? 'primary' : 'quiet'}
                  onClick={() => void setActualMinutes(assignmentId, n).then(onDone)}
                >
                  {n} min
                </Button>
              ))}
            </div>
          </>
        )}

        <div>
          {/*
            "Don't record" rather than "Cancel". Cancel implies the session did
            not happen; this one did, and only the number is being declined.
          */}
          <Button variant="quiet" onClick={onDone}>
            Don&rsquo;t record it
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
