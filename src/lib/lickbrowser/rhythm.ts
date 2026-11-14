import type { Excerpt, MetricNote } from "./types";
// Source positions already encode beats, unlike recorder input. Reuse the
// recorder's attack/release separation and brief-gap threshold without refitting
// its 8-bar, 4/4 clock over annotated solos with variable tempo and meter.
/** Recover written lengths while preserving genuine breaths and triplets. */
export function writtenNotes(r: Excerpt): MetricNote[] {
  const notes = r.notationNotes
    .filter((n) => n[0] >= r.notationStart && n[0] < r.notationEnd)
    .map((n): MetricNote => [...n])
    .sort((a, b) => a[0] - b[0]);
  // As in recorder-rhythm.ts: a long-short pair alone is not a triplet.
  // Only straighten source triplet offbeats when repeated swing pairs establish
  // the feel; preserve beats containing a complete three-attack figure.
  const triples = new Set();
  let swingVotes = 0;
  for (let i = 0; i + 2 < notes.length; i++) {
    const a = notes[i][0],
      b = notes[i + 1][0],
      c = notes[i + 2][0];
    if (b - a === 4 && c - b === 4) triples.add(Math.floor(a / 12));
    if (a % 12 === 0 && b - a === 8 && c - a === 12) swingVotes++;
  }
  if (swingVotes >= 2)
    for (const n of notes)
      if (n[0] % 12 === 8 && !triples.has(Math.floor(n[0] / 12))) {
        n[0] -= 2;
        n[2] = 3;
      }
  const beatSec = 60 / r.tempo;
  return notes
    .map((n, i): MetricNote => {
      const [at, measured, grid, pitch, raw = measured] = n,
        next = notes[i + 1]?.[0] ?? r.notationEnd;
      const interval = next - at,
        release = at + raw;
      let end = Math.min(next, at + measured);
      // Existing recorder threshold: gaps <= max(0.32 beat, 120 ms) belong
      // to articulation, not a written rest. Never bridge an absent next attack.
      if (notes[i + 1] && next - release <= Math.max(0.32, 0.12 / beatSec) * 12)
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
