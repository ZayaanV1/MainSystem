import { useEffect, useState } from 'react';
import { clockFace, layoutMatrix, MATRIX_ROWS } from '../lib/dotMatrix';
import { localHourMinute } from '../lib/time';

/**
 * The time on a dot-matrix panel, after the clock widget of Nothing OS: every
 * dot of the panel drawn, the lit ones in the text colour and the rest
 * faintly, and the colon in the theme's one red, ticking with the seconds.
 *
 * It is the ACCOUNT's time, through the same time layer as every deadline,
 * not the device's: a clock that disagreed with "due at 3:00 p.m." on the
 * same screen would make one of them look wrong.
 *
 * It re-reads at each minute boundary and whenever the app comes back to the
 * front, rather than every second: a phone that slept for an hour would
 * otherwise show the hour it fell asleep until the next tick happened to land.
 */
export function DotClock({ className = '' }: { className?: string }) {
  const [now, setNow] = useState(() => localHourMinute());

  useEffect(() => {
    let timer: number | undefined;
    const read = () => setNow(localHourMinute());
    const schedule = () => {
      window.clearTimeout(timer);
      // A little past the boundary, so the read never lands a hair early.
      timer = window.setTimeout(() => {
        read();
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      read();
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const { text, period } = clockFace(now.hour, now.minute);
  const { dots, cols } = layoutMatrix(text);
  const spoken = `${text.trim()} ${period === 'AM' ? 'a.m.' : 'p.m.'}`;
  const iso = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;

  return (
    <time dateTime={iso} aria-label={spoken} className={`dot-clock ${className}`}>
      <svg aria-hidden viewBox={`0 0 ${cols * 10} ${MATRIX_ROWS * 10}`} className="dot-clock-panel">
        {dots.map((d) => (
          <circle
            key={`${d.x}.${d.y}`}
            cx={d.x * 10 + 5}
            cy={d.y * 10 + 5}
            r={3.7}
            className={d.on ? (d.colon ? 'dot-clock-colon' : 'dot-clock-on') : 'dot-clock-off'}
          />
        ))}
      </svg>
      <span aria-hidden className="dot-clock-period">
        {period}
      </span>
    </time>
  );
}
