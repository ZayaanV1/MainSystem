import { useEffect, useState } from 'react';

/**
 * The current time, re-rendered on the minute.
 *
 * Aligned to the minute boundary rather than ticking every sixty seconds from
 * whenever the screen mounted, so the line for now on the hour grid moves at
 * the moment the clock on the phone does rather than up to a minute after it.
 * A calendar whose "now" disagrees with the status bar is one you stop
 * trusting about everything else.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const untilNextMinute = 60_000 - (Date.now() % 60_000);
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, untilNextMinute);

    // A phone that slept through an hour wakes to a stale line otherwise.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return now;
}
