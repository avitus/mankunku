import type { Excerpt, MetricNote } from './types';
import { fitPhraseRhythm } from '$lib/music/phrase-rhythm';
import { annotatedRhythmHints } from '$lib/music/annotated-rhythm';

/** Fit a whole Weimar excerpt on its annotated beat clock. Measured seconds
 * remain exclusively in the performance Phrase; source notation supplies hints. */
export function writtenNotes(r: Excerpt): MetricNote[] {
  const source = r.notationNotes.filter(n => n[0] >= r.notationStart && n[0] < r.notationEnd)
    .slice().sort((a, b) => a[0] - b[0]);
  const endBeat = (r.notationEnd - r.notationStart) / 12;
  const hints = annotatedRhythmHints(source.map(n => ({
    at: (n[0] - r.notationStart) / 12, duration: n[1] / 12,
  })), endBeat);
  const { notes } = fitPhraseRhythm(source.map(n => ({
    pitch: n[3], at: ((n[5] ?? n[0]) - r.notationStart) / 12,
    release: ((n[6] ?? n[0] + (n[4] ?? n[1])) - r.notationStart) / 12,
  })), {
    endBeat, beatSeconds: 60 / r.tempo, ticksPerBeat: 12,
    slots: [0, 3, 4, 6, 8, 9], phases: [0], hints,
  });
  return notes.flatMap((n): MetricNote[] => n.pitch === null ? [] : [[
    r.notationStart + Math.round(n.offset[0] / n.offset[1] * 48),
    Math.round(n.duration[0] / n.duration[1] * 48), 3, n.pitch,
  ]]);
}
/** Require entrances at both ends and activity throughout the progression. */
export function coversProgression(r: Excerpt): boolean {
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
