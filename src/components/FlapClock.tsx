import { useState } from 'react';
import { clockFace } from '../lib/dotMatrix';
import { useMinuteClock } from './DotClock';

/**
 * One flap of the clock. When its character changes, the old top half falls
 * away and the new bottom half drops in (flap.css). Both moving halves are
 * keyed by the character, so each change mounts a fresh pair and the pair
 * that has landed simply stays, covering the old bottom half beneath it.
 */
function Flap({ ch }: { ch: string }) {
  const [pair, setPair] = useState({ now: ch, was: ch });
  if (pair.now !== ch) setPair({ now: ch, was: pair.now });
  const turned = pair.was !== ch;
  return (
    <span className={ch === ':' ? 'fl fl-n' : 'fl'}>
      <b className="fl-top">{ch}</b>
      <b className="fl-bot">{turned ? pair.was : ch}</b>
      {turned && (
        <>
          <b key={`t${ch}`} className="fl-top fl-fall">{pair.was}</b>
          <b key={`b${ch}`} className="fl-bot fl-drop">{ch}</b>
        </>
      )}
    </span>
  );
}

/**
 * The time on split flaps, after a Solari board and the Cifra 3 desk clock.
 * The account's time, like the dot-matrix clock it shares a masthead with,
 * and turning over on the minute.
 */
export function FlapClock() {
  const now = useMinuteClock();
  const { text, period } = clockFace(now.hour, now.minute);
  const spoken = `${text.trim()} ${period === 'AM' ? 'a.m.' : 'p.m.'}`;
  const iso = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;

  return (
    // role="img": the flaps are a picture of the spoken time, as the dots are.
    <time dateTime={iso} role="img" aria-label={spoken} className="flap-clock">
      <span aria-hidden className="flap-clock-face">
        {[...text].map((ch, i) => (
          <Flap key={i} ch={ch} />
        ))}
      </span>
      <span aria-hidden className="flap-clock-period">
        {period}
      </span>
    </time>
  );
}
