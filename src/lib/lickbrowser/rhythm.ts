import type { Excerpt, MetricNote } from "./types";
import { articulationGapBeats, tripletAttackEvidence } from "$lib/music/rhythm-evidence";

/** Infer swing only within continuous eighth-note runs on the annotated clock.
 * Repeated 3:1 cells retain their explicit dotted motif; an isolated 3:1 cell
 * needs two neighbouring ordinary/swing pairs before it can read as eighths. */
function swingPairs(notes: MetricNote[], end: number, gap: number): Set<number> {
  const triplets = tripletAttackEvidence(notes.map(n => n[0] / 12));
  const pairs: { index: number; beat: number; offbeat: number }[] = [];
  for (let i = 0; i + 1 < notes.length; i++) {
    const [at, measured, , , raw = measured] = notes[i];
    const [off, offMeasured, , , offRaw = offMeasured] = notes[i + 1];
    const boundary = at + 12;
    if (at % 12 !== 0 || ![6, 8, 9].includes(off - at) || boundary > end ||
      (notes[i + 2]?.[0] ?? end) !== boundary || (triplets[i] && triplets[i + 1]) ||
      off - (at + raw) > gap || boundary - (off + offRaw) > gap) continue;
    pairs.push({ index: i, beat: at / 12, offbeat: off - at });
  }
  const straightened = new Set<number>();
  for (let start = 0; start < pairs.length;) {
    let stop = start + 1;
    while (stop < pairs.length && pairs[stop].beat === pairs[stop - 1].beat + 1) stop++;
    const run = pairs.slice(start, stop);
    const eighthPairs = run.filter(p => p.offbeat !== 9).length;
    for (const [j, pair] of run.entries()) {
      const dottedMotif = run[j - 1]?.offbeat === 9 || run[j + 1]?.offbeat === 9;
      if ((pair.offbeat === 8 && eighthPairs >= 2) ||
        (pair.offbeat === 9 && eighthPairs >= 2 && !dottedMotif)) {
        straightened.add(pair.index);
        straightened.add(pair.index + 1);
      }
    }
    start = stop;
  }
  return straightened;
}

// Source positions already encode beats, unlike recorder input. Reuse the
// recorder's attack/release separation and brief-gap threshold without refitting
// its 8-bar, 4/4 clock over annotated solos with variable tempo and meter.
/** Recover written lengths while preserving genuine breaths and triplets. */
export function writtenNotes(r: Excerpt): MetricNote[] {
  const notes = r.notationNotes
    .filter((n) => n[0] >= r.notationStart && n[0] < r.notationEnd)
    .map((n): MetricNote => [...n])
    .sort((a, b) => a[0] - b[0]);
  const gap = articulationGapBeats(r.tempo) * 12;
  const straightened = swingPairs(notes, r.notationEnd, gap);
  return notes
    .map((n, i): MetricNote => {
      const [at, measured, grid, pitch, raw = measured] = n,
        next = notes[i + 1]?.[0] ?? r.notationEnd;
      // Infer both written lengths together, including a terminal pair. All
      // release/gap evidence above uses ORIGINAL positions; playback is separate.
      if (straightened.has(i)) return [Math.floor(at / 12) * 12 + (at % 12 === 0 ? 0 : 6), 6, 3, pitch];
      const interval = next - at,
        release = at + raw;
      let end = Math.min(next, at + measured);
      // Existing recorder threshold: gaps <= max(0.32 beat, 120 ms) belong
      // to articulation, not a written rest. Never bridge an absent next attack.
      if (notes[i + 1] && next - release <= gap)
        end = next;
      // Short on-beat quarters commonly sound for about an eighth. Infer a
      // quarter only within one beat, never fill a longer breath or phrase gap.
      // Includes the final short quarter, where no following onset is available.
      if (at % 12 === 0 && raw >= 4 && raw <= 10 && interval >= 12)
        end = Math.max(end, at + 12);
      return [at, Math.max(0, Math.min(end, r.notationEnd) - at), grid, pitch];
    })
    .filter((n) => n[1] > 0);
}
/** Require entrances at both ends and activity throughout the progression. */
export function coversProgression(r: Excerpt) {
  const notes = writtenNotes(r);
  if (!notes.length) return false;
  const boundaries = [...r.chords.map((c) => c.tick), r.notationEnd];
  const first = notes[0][0],
    last = notes.at(-1)![0];
  if (first >= boundaries[1] || last < boundaries.at(-2)!) return false;
  const touched = new Set();
  const beats = new Set();
  for (const [at, dur] of notes) {
    for (let i = 0; i < boundaries.length - 1; i++)
      if (at < boundaries[i + 1] && at + dur > boundaries[i]) touched.add(i);
    for (let beat = Math.floor(at / 12); beat * 12 < at + dur; beat++)
      beats.add(beat);
  }
  const chordCount = r.chords.length;
  // Three-chord cadences must actually traverse the middle chord too.
  if (touched.size < (chordCount === 3 ? 3 : Math.floor(chordCount / 2) + 1))
    return false;
  let total = 0,
    active = 0;
  for (let b = Math.floor(r.notationStart / 12); b * 12 < r.notationEnd; b++) {
    const width =
      Math.min((b + 1) * 12, r.notationEnd) - Math.max(b * 12, r.notationStart);
    total += width;
    if (beats.has(b)) active += width;
  }
  return active > total / 2;
}
