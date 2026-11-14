import { expect, it } from 'vitest';
import baseline from '../../fixtures/recorder-rhythm-before.json';
import { quantizeRecorderRhythm, previousRecorderRhythm } from '$lib/audio/recorder-rhythm';
import { applySwingToBeats } from '$lib/music/swing';

it('Preserves the recorder outputs captured before the shared-fitter extraction', () => {
  const results = [];
  for (const tempo of [72, 120, 219, 300]) {
    for (const swing of [0.5, 0.62, 2 / 3, 0.77]) {
      const notes = [0, 0.5, 1, 1.5, 2, 7 / 3, 8 / 3, 3, 4.5, 6].map((at, i) => ({
        onsetTime: (applySwingToBeats(at, swing) + 0.18) * 60 / tempo,
        duration: (i === 9 ? 1.5 : 0.28) * 60 / tempo,
        midi: 60 + i % 5, cents: 0, clarity: 0.98,
      }));
      results.push({ tempo, swing, current: quantizeRecorderRhythm(notes, tempo),
        previous: previousRecorderRhythm(notes, tempo),
        placed: quantizeRecorderRhythm(notes, tempo, undefined, 3),
        optional: quantizeRecorderRhythm(notes, tempo, notes.map((_, i) => i === 4 ? 0.01 : Infinity)) });
    }
  }
  expect(results).toEqual(baseline);
});
