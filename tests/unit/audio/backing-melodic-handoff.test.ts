import { expect, it } from 'vitest';
import { fitBassAnswer, type HeardNote } from '$lib/audio/backing-melodic-handoff';

import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

const source: HeardNote[] = [65, 69, 72, 67].map((midi, beat) => ({ beat, midi }));
const segments = [
 { start: 4, length: 2, chordPcs: [5, 9, 0, 3] },
 { start: 6, length: 2, chordPcs: [10, 2, 5, 8] }
];

it('sequences the played keyboard contour through a mid-bar chord change, keeping its bass arrivals', () => {
 const walk = [41, 43, 46, 41].map((midi, index) => ({ midi, absBeat: index + 4, time: index+'i', duration: .4, velocity: 88 }));
 const answer = fitBassAnswer(source, walk, segments);
 expect(answer).toEqual([41, 45, 46, 41]);
 const anticipatedChange = [{ ...segments[0], length: 1.5 }, { ...segments[1], start: 5.5, length: 2.5 }];
 expect(fitBassAnswer(source, walk, anticipatedChange)).toEqual(answer);
 expect(fitBassAnswer(source, walk, segments.slice(0, 1))).toBeUndefined();
 expect(fitBassAnswer(source.slice(1), walk, segments)).toBeUndefined();
});

it.each([
 { instrument: 'piano' as const, tempo: 128, seed: 29, notes: [43, 38, 38, 41] },
 { instrument: 'organ' as const, tempo: 128, seed: 29, notes: [43, 38, 38, 41] },
 { instrument: 'piano' as const, tempo: 112, seed: 37, notes: [43, 46, 46, 41, 41] }
])('hands off a complete played phrase in the $tempo BPM $instrument take', ({ instrument, tempo, seed, notes }) => {
 const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const style = BACKING_STYLES.swing;
 const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = releasedBackingOptions(instrument, seed);
 const score = createRollingBacking(phrase.harmony, style, params, options);
 const old = createRollingBacking(phrase.harmony, style, params, { ...options, melodicHandoff: undefined });
 let checkpoint: RollingBackingCheckpoint | undefined;
 let baseline: RollingBackingCheckpoint | undefined;
 const played = new Map<number, number>();
 let heardAnswer = false;
 for (let bar = 0; bar < score.totalBars; bar++) {
  const actual = advanceRollingBacking(score, checkpoint);
  const prior = advanceRollingBacking(old, baseline);
  const hits = actual.bassEvents.filter(event => event.melodicSource);
  if (bar === 36) {
   heardAnswer = true;
   expect(hits.map(e => e.midi)).toEqual(notes);
   expect(actual.checkpoint.bass.openingMotif).toBeNull();
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(actual.checkpoint)))).toEqual(advanceRollingBacking(score, actual.checkpoint));
   expect(prior.bassEvents.map(e => e.midi)).not.toEqual(notes);
   expect(hits.map(e => [e.time, e.duration])).toEqual(prior.bassEvents.map(e => [e.time, e.duration]));
   for (const note of hits[0].melodicSource!) expect(played.get(note.beat)).toBe(note.midi);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(actual);
   const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0 }]);
   expect(busy.bassEvents.some(e => e.melodicSource)).toBe(false);
   expect(actual.compEvents).toEqual(prior.compEvents);
   expect(actual.drumEvents).toEqual(prior.drumEvents);
  }
  for (const event of actual.compEvents) played.set(event.absBeat, Math.max(played.get(event.absBeat) ?? 0, ...event.notes));
  checkpoint = actual.checkpoint;
  baseline = prior.checkpoint;
 }
 expect(heardAnswer).toBe(true);
});

it('restores a fitted bass answer with phrase dialogue disabled', () => {
 const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const style = BACKING_STYLES.swing;
 const score = createRollingBacking(phrase.harmony, style, {
  phraseId: phrase.id, tempo: 128, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
  performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
 }, { ...releasedBackingOptions('piano', 29), phraseDialogue: undefined });
 let checkpoint: RollingBackingCheckpoint | undefined;
 for (let bar = 0; bar < score.totalBars - 1; bar++) {
  const result = advanceRollingBacking(score, checkpoint);
  checkpoint = result.checkpoint;
  if (!result.bassEvents.some(event => event.melodicSource)) continue;
  expect(checkpoint.bass).not.toHaveProperty('openingMotif');
  expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(advanceRollingBacking(score, checkpoint));
  return;
 }
 throw new Error('Expected the seeded walk to fit a melodic answer');
});
