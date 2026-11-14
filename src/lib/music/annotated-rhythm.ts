import { tripletAttackEvidence } from './rhythm-evidence';
import type { RhythmHint } from './phrase-rhythm';

/** Protect complete figures in source notation. Ambiguous attacks remain
 * candidates for the shared phrase fitter; this never assigns new positions. */
export function annotatedRhythmHints(source: RhythmHint[], endBeat: number): RhythmHint[] {
  const hints = source.map((n, i) => ({ ...n,
    duration: Math.min(n.duration, (source[i + 1]?.at ?? endBeat) - n.at), fixed: false }));
  const triplets = tripletAttackEvidence(hints.map(n => n.at));
  const ticks = new Set(hints.map(n => Math.round(n.at * 12)));
  for (let i = 0; i < hints.length; i++) {
    // A boundary attack shared with the next figure doesn't itself make that
    // next figure a triplet. Protect tuplets' actual fractional positions.
    const beat = Math.floor(hints[i].at) * 12;
    if (triplets[i] && !Number.isInteger(hints[i].at * 2) && ticks.has(beat + 4) && ticks.has(beat + 8)) hints[i].fixed = true;
    if (hints[i].duration > 1) hints[i].fixed = true;
  }
  for (let i = 2; i < hints.length; i++) {
    if (Math.abs(hints[i].at - hints[i - 1].at - 2 / 3) < 1e-8 &&
      Math.abs(hints[i - 1].at - hints[i - 2].at - 2 / 3) < 1e-8) {
      for (let j = i - 2; j <= i; j++) hints[j].fixed = true;
    }
    if (Math.abs(hints[i].at - hints[i - 1].at - 0.25) < 1e-8 &&
      Math.abs(hints[i - 1].at - hints[i - 2].at - 0.25) < 1e-8) {
      for (let j = i - 2; j <= i; j++) hints[j].fixed = true;
    }
  }
  const dotted = new Map<number, number>();
  for (let i = 0; i + 1 < hints.length; i++) {
    if (Number.isInteger(hints[i].at) && hints[i + 1].at - hints[i].at === 0.75 &&
      (hints[i + 2]?.at ?? endBeat) - hints[i].at === 1) dotted.set(hints[i].at, i);
  }
  for (const [beat, i] of dotted) {
    if (dotted.has(beat - 1) || dotted.has(beat + 1)) hints[i].fixed = hints[i + 1].fixed = true;
  }
  // Do not reinterpret an isolated figure, or an entirely displaced line with
  // no metrical anchors, based on a different phrase across a breath or sustain.
  let from = 0;
  for (let i = 0; i <= hints.length; i++) {
    const boundary = i === hints.length || (i > from &&
      (hints[i].at - hints[i - 1].at > 1 || hints[i - 1].duration > 1));
    if (!boundary) continue;
    const region = hints.slice(from, i);
    if (region.length < 4 || region.filter(n => Number.isInteger(n.at * 2)).length < 2) {
      for (const hint of region) if (!Number.isInteger(hint.at * 2)) hint.fixed = true;
    }
    from = i;
  }
  return hints;
}
