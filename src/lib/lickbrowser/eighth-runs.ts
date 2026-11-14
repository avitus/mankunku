import { tripletAttackEvidence } from '$lib/music/rhythm-evidence';
import type { MetricNote } from './types';

interface Path {
  positions: number[];
  cost: number;
}

/** Fit a displaced run to eighths as a sequence, so later attacks settle
 * half-grid ties. Like the recorder, score both attack error and interval shape.
 * Unlike its free clock fit, retain Weimar's beat anchors and every attack. */
function alignRun(notes: MetricNote[], start: number, end: number): number[] | undefined {
  let paths: Path[] = [];
  for (const [i, note] of notes.entries()) {
    const at = note[0];
    const candidates = [...new Set([Math.floor(at / 6) * 6, Math.ceil(at / 6) * 6])]
      .filter(tick => tick >= start && tick + 6 <= end && Math.abs(tick - at) <= 3);
    const next: Path[] = [];
    for (const tick of candidates) {
      const attackCost = ((tick - at) / 12) ** 2;
      if (i === 0) {
        next.push({ positions: [tick], cost: attackCost });
        continue;
      }
      let best: Path | undefined;
      for (const path of paths) {
        const span = tick - path.positions.at(-1)!;
        // An eighth rest may interrupt a run. Never merge attacks or squeeze
        // a genuine sixteenth run onto the same eighth-note positions.
        if (span !== 6 && span !== 12) continue;
        const intervalError = (span - (at - notes[i - 1][0])) / 12;
        const cost = path.cost + attackCost + 0.6 * intervalError ** 2 + (span === 12 ? 0.08 : 0);
        if (!best || cost < best.cost) best = { positions: [...path.positions, tick], cost };
      }
      if (best) next.push(best);
    }
    if (!next.length) return;
    paths = next;
  }
  return paths.reduce((a, b) => a.cost <= b.cost ? a : b).positions;
}

/** Recover displaced eighth runs only when multiple ambiguous attacks and
 * exact eighth-grid anchors support them. Preserve explicit rhythmic figures. */
export function displacedEighths(notes: MetricNote[], start: number, end: number): Map<number, number> {
  const protectedNotes = tripletAttackEvidence(notes.map(n => n[0] / 12));
  const dotted = new Map<number, number>();
  for (let i = 0; i + 1 < notes.length; i++) {
    const at = notes[i][0];
    if (at % 12 === 0 && notes[i + 1][0] === at + 9 &&
      (notes[i + 2]?.[0] ?? end) === at + 12) dotted.set(at / 12, i);
  }
  for (const [beat, i] of dotted) {
    if (dotted.has(beat - 1) || dotted.has(beat + 1)) {
      protectedNotes[i] = protectedNotes[i + 1] = true;
    }
  }
  const result = new Map<number, number>();
  let from = 0;
  // Rests longer than an eighth and held notes divide independent figures.
  for (let i = 0; i <= notes.length; i++) {
    const note = notes[i];
    const raw = note?.[4] ?? note?.[1] ?? 0;
    const held = note && (raw > 10 || (raw > 7.5 && (notes[i + 1]?.[0] ?? end) - note[0] >= 12));
    const excluded = !note || protectedNotes[i] || held;
    const gap = i > from && note && note[0] - notes[i - 1][0] > 12;
    if (!excluded && !gap) continue;
    const run = notes.slice(from, i);
    if (run.length >= 4 && run.filter(n => n[0] % 6 === 3).length >= 2 &&
      run.filter(n => n[0] % 6 === 0).length >= 2) {
      // A preceding protected figure may release at this run's first attack;
      // moving that entrance backwards would overlap it.
      const positions = alignRun(run, from > 0 ? Math.max(start, run[0][0]) : start,
        Math.min(end, note?.[0] ?? end));
      if (positions && positions.some((at, j) => j >= 3 &&
        at - positions[j - 3] === 18)) {
        positions.forEach((at, j) => result.set(from + j, at));
      }
    }
    from = excluded ? i + 1 : i;
  }
  return result;
}
