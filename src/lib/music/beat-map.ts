/** Interpolate recorded seconds onto an annotated beat clock, including tempo
 * changes. At the ends, extrapolate only the nearest measured beat interval. */
export function beatAtTime(beats: readonly number[], seconds: number): number | undefined {
  if (beats.length < 2) return;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid] <= seconds) lo = mid;
    else hi = mid;
  }
  const span = beats[lo + 1] - beats[lo];
  if (!(span > 0)) return;
  return lo + (seconds - beats[lo]) / span;
}
