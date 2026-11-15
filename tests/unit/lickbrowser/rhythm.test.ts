import { describe, expect, it } from 'vitest';
import { writtenNotes } from '$lib/lickbrowser/rhythm';
import { search, parseQuery } from '$lib/lickbrowser/search';
import { excerptPhrases } from '$lib/lickbrowser/phrase';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { Excerpt, Solo } from '$lib/lickbrowser/types';
import corpus from '../../../static/data/weimar-licks.json';
import { BROWSER_PROGRESSIONS, searchProgression } from '$lib/lickbrowser/progressions';

/** An excerpt with notes at the given 24-per-beat attack ticks. */
function excerpt(attacks: number[], end: number, durations = attacks.map((at, i) => (attacks[i + 1] ?? end) - at)): Excerpt {
  return {
    id: 'rhythm', sourceId: 1, performer: 'Test', title: 'Rhythm', instrument: 'ts',
    tempo: 120, start: 0, end: end / 24, bar: 1, beat: 1, shift: 0,
    notationStart: 0, notationEnd: end, bars: [[0, '4/4', 1]],
    chords: [{ label: 'Cmaj7', original: 'Cmaj7', time: 0, tick: 0 }],
    notes: attacks.map((at, i) => [at / 24, durations[i] / 24, 60 + i]),
    notationNotes: attacks.map((at, i) => [at, durations[i], 3, 60 + i, durations[i]]),
  };
}

/** The written notes' [attack, duration] pairs. */
const rhythm = (r: Excerpt) => writtenNotes(r).map(([at, duration]) => [at, duration]);

describe('Weimar swing notation', () => {
  it('Fits the corpus across every supported progression without empty or overlapping notation', () => {
    for (const progression of BROWSER_PROGRESSIONS) {
      const results = searchProgression(corpus as unknown as Solo[], progression.type);
      for (const r of results) {
        const notes = writtenNotes(r);
        expect(notes.length, `${progression.type}: ${r.id}`).toBeGreaterThan(0);
        for (let i = 0; i < notes.length; i++) {
          expect(notes[i][1], r.id).toBeGreaterThan(0);
          expect(notes[i][0] + notes[i][1], r.id).toBeLessThanOrEqual(notes[i + 1]?.[0] ?? r.notationEnd);
        }
      }
    }
  });
  it('Writes WJD 1-96 as eighths while retaining its entrance and internal rest', () => {
    const r = search(corpus as unknown as Solo[], parseQuery('Dm7 G7 Cmaj7')).find(r => r.id === '1-96')!;
    const original = structuredClone(r);
    expect(writtenNotes(r).map(([at, duration]) => [at - r.notationStart, duration]))
      .toEqual([12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 78, 84].map(at => [at, 6]));
    const { performance } = excerptPhrases(r, INSTRUMENTS['tenor-sax'], 68);
    performance.notes.forEach((n, i) => {
      expect(n.offset[0] / n.offset[1]).toBeCloseTo(Math.round(r.notes[i][0] * r.tempo * 1000) / 240000, 10);
      expect(n.duration[0] / n.duration[1]).toBeCloseTo(Math.round(r.notes[i][1] * r.tempo * 1000) / 240000, 10);
    });
    expect(r).toEqual(original);
  });

  it('Uses later grid anchors to resolve a displaced eighth-note entrance', () => {
    expect(rhythm(excerpt([9, 15, 21, 30, 33, 42, 48, 56, 60], 66, [6, 4, 8, 3, 6, 6, 5, 3, 6])))
      .toEqual([12, 18, 24, 30, 36, 42, 48, 54, 60].map(at => [at, 6]));
  });

  it('Resolves half-grid ties backwards when the surrounding run requires it', () => {
    expect(rhythm(excerpt([0, 9, 15, 21, 24, 30], 36, [8, 6, 6, 3, 6, 6])))
      .toEqual([0, 6, 12, 18, 24, 30].map(at => [at, 6]));
  });

  it('Preserves a real sixteenth-note run', () => {
    const r = excerpt([0, 3, 6, 9, 12, 18, 24, 30], 36);
    expect(rhythm(r)).toEqual(r.notationNotes.map(([at, duration]) => [at, duration]));
  });

  it('Keeps a displaced run without enough on-grid evidence unchanged', () => {
    const r = excerpt([3, 9, 15, 21], 27);
    expect(rhythm(r)).toEqual(r.notationNotes.map(([at, duration]) => [at, duration]));
  });

  it('Does not move an inferred entrance backwards into a held note', () => {
    const r = excerpt([0, 21, 27, 33, 36, 42], 48);
    expect(rhythm(r)).toEqual(r.notationNotes.map(([at, duration]) => [at, duration]));
  });

  it('Keeps inferred corpus notes ordered and non-overlapping', () => {
    for (const r of search(corpus as unknown as Solo[], parseQuery('Dm7 G7 Cmaj7'))) {
      const notes = writtenNotes(r);
      for (let i = 0; i < notes.length; i++) {
        expect(notes[i][0], r.id).toBeGreaterThanOrEqual(r.notationStart);
        expect(notes[i][0] + notes[i][1], r.id).toBeLessThanOrEqual(notes[i + 1]?.[0] ?? r.notationEnd);
      }
    }
  });

  it('Writes WJD 1-63 as ordinary eighths, including its final swung pair', () => {
    const r = search(corpus as unknown as Solo[], parseQuery('Dm7 G7 Cmaj7')).find(r => r.id === '1-63')!;
    const original = structuredClone(r);
    expect(writtenNotes(r).map(([at, duration]) => [at - r.notationStart, duration]))
      .toEqual(Array.from({ length: 11 }, (_, i) => [6 + i * 6, 6]));
    const { score, performance } = excerptPhrases(r, INSTRUMENTS['tenor-sax'], 68);
    expect(score.notes.every(n => n.duration[0] / n.duration[1] === 1 / 8)).toBe(true);
    performance.notes.forEach((n, i) => {
      expect(n.offset[0] / n.offset[1]).toBeCloseTo(Math.round(r.notes[i][0] * r.tempo * 1000) / 240000, 10);
      expect(n.duration[0] / n.duration[1]).toBeCloseTo(Math.round(r.notes[i][1] * r.tempo * 1000) / 240000, 10);
    });
    expect(r).toEqual(original);
  });

  it('Uses an eighth-note run to resolve mixed 3:1 and 2:1 timing', () => {
    expect(rhythm(excerpt([0, 9, 12, 18, 24, 30, 36, 44], 48)))
      .toEqual(Array.from({ length: 8 }, (_, i) => [i * 6, 6]));
  });

  it('Keeps an isolated dotted-eighth/sixteenth figure', () => {
    expect(rhythm(excerpt([0, 9], 12))).toEqual([[0, 9], [9, 3]]);
  });

  it('Keeps a repeated dotted motif even inside an eighth-note passage', () => {
    const r = excerpt([0, 6, 12, 21, 24, 33, 36, 42], 48);
    expect(rhythm(r)).toEqual(r.notationNotes.map(([at, duration]) => [at, duration]));
  });

  it('Keeps dotted quarters and their following eighths', () => {
    const r = excerpt([0, 18, 24, 42], 48);
    expect(rhythm(r)).toEqual([[0, 18], [18, 6], [24, 18], [42, 6]]);
  });

  it('Keeps full eighth triplets after a swung run', () => {
    expect(rhythm(excerpt([0, 8, 12, 20, 24, 28, 32], 36)))
      .toEqual([[0, 6], [6, 6], [12, 6], [18, 6], [24, 4], [28, 4], [32, 4]]);
  });

  it('Keeps quarter-note triplets crossing beats', () => {
    expect(rhythm(excerpt([0, 8, 16, 24, 32, 40], 48)))
      .toEqual([0, 8, 16, 24, 32, 40].map(at => [at, 8]));
  });

  it('Keeps a rested triplet entrance', () => {
    expect(rhythm(excerpt([4, 8, 12], 24))).toEqual([[4, 4], [8, 4], [12, 12]]);
  });

  it('Does not use eighths across a breath to straighten a dotted figure', () => {
    expect(rhythm(excerpt([0, 9, 36, 42, 48, 54], 60, [9, 3, 6, 6, 6, 6])))
      .toEqual([[0, 9], [9, 3], [36, 6], [42, 6], [48, 6], [54, 6]]);
  });

  it('Does not shorten an offbeat sustain to complete an eighth-note pair', () => {
    const r = excerpt([0, 6, 12, 18, 24, 32, 48], 60);
    expect(writtenNotes(r).find(n => n[3] === 65)?.slice(0, 2)).toEqual([32, 16]);
  });
});
