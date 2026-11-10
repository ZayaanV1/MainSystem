/**
 * The frame meter (`?frames`): frame intervals during a gesture or transition,
 * reported as the median and the worst 1%. Loaded only when the address asks
 * for it, so it costs a normal launch nothing. Numbers only count from real
 * hardware; a simulator or a hidden tab reports its own timing, not the phone's.
 */

export interface FrameStats {
  frames: number;
  median: number;
  /** The 99th percentile interval: one frame in a hundred is slower than this. */
  worst: number;
}

export function frameStats(intervals: number[]): FrameStats | null {
  if (!intervals.length) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { frames: sorted.length, median: at(0.5), worst: at(0.99) };
}

export function startFrameMeter(): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText =
    'position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 8px);z-index:9999;min-height:44px;padding:0 12px;' +
    'border-radius:12px;background:var(--ink-800);color:var(--text-hi);border:1px solid var(--ink-600);font:13px var(--font-mono)';
  const idle = 'Frames: tap to record';
  button.textContent = idle;

  let intervals: number[] | null = null;
  let last = 0;
  const tick = (t: number) => {
    if (!intervals) return;
    if (last) intervals.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };

  button.addEventListener('click', () => {
    if (intervals) {
      const s = frameStats(intervals);
      intervals = null;
      button.textContent = s
        ? `median ${s.median.toFixed(1)} ms, worst 1% ${s.worst.toFixed(1)} ms, ${s.frames} frames`
        : idle;
      return;
    }
    intervals = [];
    last = 0;
    button.textContent = 'Recording. Tap to stop';
    requestAnimationFrame(tick);
  });
  document.body.append(button);
}
