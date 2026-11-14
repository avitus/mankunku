/** Mark complete equal-third figures, including rested and quarter-note triplets.
 * Long-short swing pairs alone are not evidence of a written tuplet. */
export function tripletAttackEvidence(times: number[]): boolean[] {
  const evidence = times.map(() => false);
  for (let i = 2; i < times.length; i++) {
    const left = times[i - 1] - times[i - 2];
    const right = times[i] - times[i - 1];
    if ([1 / 3, 2 / 3].some(span => Math.abs(left - span) < 0.075 && Math.abs(right - span) < 0.075)) {
      evidence.fill(true, i - 2, i + 1);
    }
  }
  return evidence;
}

/** Maximum silence in beats treated as articulation rather than a written rest. */
export function articulationGapBeats(tempo: number): number {
  return Math.max(0.32, 0.12 / (60 / tempo));
}
