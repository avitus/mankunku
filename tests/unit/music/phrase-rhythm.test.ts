import { expect, it } from 'vitest';
import { fitPhraseRhythm } from '$lib/music/phrase-rhythm';
import { beatAtTime } from '$lib/music/beat-map';
import { annotatedRhythmHints } from '$lib/music/annotated-rhythm';

const pitched = (result: ReturnType<typeof fitPhraseRhythm>) => result.notes
  .filter(n => n.pitch !== null)
  .map(n => [n.offset[0] / n.offset[1] * 4, n.duration[0] / n.duration[1] * 4]);

it('Fits the same notation across a variable annotated beat clock', () => {
  const beats = [10, 10.5, 11.5, 11.75, 12.5];
  const seconds = [10, 10.25, 10.5, 11, 11.5, 11.625, 11.75, 12.125];
  const events = seconds.map((at, i) => ({ pitch: 60 + i,
    at: beatAtTime(beats, at)!, release: beatAtTime(beats, seconds[i + 1] ?? 12.5)! }));
  expect(events.map(n => n.at)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  const hints = annotatedRhythmHints(events.map(n => ({ at: n.at, duration: 0.5 })), 4);
  expect(pitched(fitPhraseRhythm(events, { endBeat: 4, beatSeconds: 0.5,
    ticksPerBeat: 12, slots: [0, 3, 4, 6, 8, 9], phases: [0], hints })))
    .toEqual(events.map(n => [n.at, 0.5]));
});

it('Supports phrases beyond eight bars and a partial final beat', () => {
  const hints = [33, 33.5, 34, 34.5].map(at => ({ at, duration: at === 34.5 ? 0.25 : 0.5, fixed: true }));
  const events = hints.map(n => ({ pitch: 60, at: n.at, release: n.at + n.duration }));
  expect(pitched(fitPhraseRhythm(events, { endBeat: 34.75, beatSeconds: 0.5,
    ticksPerBeat: 12, slots: [0, 3, 4, 6, 8, 9], phases: [0], hints })))
    .toEqual(hints.map(n => [n.at, n.duration]));
});

it('Retains a source figure mixing straight and triplet subdivisions in one beat', () => {
  const hints = [{ at: 0, duration: 1 / 3, fixed: true },
    { at: 1 / 3, duration: 1 / 6, fixed: true }, { at: 0.5, duration: 0.5, fixed: true }];
  const events = hints.map(n => ({ pitch: 60, at: n.at, release: n.at + n.duration }));
  expect(pitched(fitPhraseRhythm(events, { endBeat: 1, beatSeconds: 0.5,
    ticksPerBeat: 12, slots: [0, 3, 4, 6, 8, 9], phases: [0], hints })))
    .toEqual(hints.map(n => [n.at, n.duration]));
});

it('Extrapolates a pickup or release using the nearest measured beat', () => {
  expect(beatAtTime([2, 2.5, 3.5], 1.75)).toBe(-0.5);
  expect(beatAtTime([2, 2.5, 3.5], 4)).toBe(2.5);
});
