import { expect, it } from 'vitest';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';

it.each([
 ['scenario-fly-me-to-the-moon', [[7, 45], [28, 38], [87, 45]]],
 ['scenario-all-the-things-you-are', [[18, 43], [22, 40], [78, 36]]]
] as const)('anticipates selected written resolutions in the full Bossa heads of %s (S12/B7)', (tuneId, expected) => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId, soloChoruses: 1 });
 const style = BACKING_STYLES['bossa-nova'];
 const settings = { phraseId: phrase.id, tempo: 144, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
  performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = releasedBackingOptions('piano', 0);
 const score = createRollingBacking(phrase.harmony, style, settings, options);
 const baseline = createRollingBacking(phrase.harmony, style, settings, { ...options, eighthAnticipation: undefined });
 let checkpoint: RollingBackingCheckpoint | undefined;
 let historical: RollingBackingCheckpoint | undefined;
 const landmarks = [];
 for (let bar = 0; bar < bars.length; bar++) {
  const played = advanceRollingBacking(score, checkpoint);
  const control = advanceRollingBacking(baseline, historical);
  const pickup = played.bassEvents.find(event => event.eighthAnticipatedRoot);
  expect(played.compEvents).toEqual(control.compEvents);
  expect(played.drumEvents).toEqual(control.drumEvents);
  if (pickup) {
   expect(bars[bar].context.role).toBe('head');
   expect(pickup.absBeat - bar * 4).toBe(3.5);
   expect(played.bassEvents.map(event => event.time)).toEqual(control.bassEvents.map(event => event.time));
   expect(control.bassEvents.at(-1)?.midi).not.toBe(pickup.midi);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   expect(played.checkpoint.bass.previousMidi).toBe(pickup.midi);
   const next = advanceRollingBacking(score, played.checkpoint).bassEvents[0];
   expect([next.absBeat, next.midi]).toEqual([(bar + 1) * 4, pickup.midi]);
   const busy = advanceRollingBacking(score, checkpoint, [{
    source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0
   }]);
   expect(busy.bassEvents.some(event => event.eighthAnticipatedRoot)).toBe(false);
   landmarks.push([bar + 1, pickup.midi]);
  } else if (tuneId === 'scenario-all-the-things-you-are' && bar === 22) {
   // The preceding E replaces B as the approach. This releases the old delayed-root choice.
   expect(played.bassEvents.map(event => event.midi)).toEqual([40, 35, 35]);
   expect(control.bassEvents.map(event => event.midi)).toEqual([35, 35, 40]);
  } else expect(played.bassEvents).toEqual(control.bassEvents);
  checkpoint = played.checkpoint;
  historical = control.checkpoint;
 }
 expect(landmarks).toEqual(expected);
});

it('keeps the native pickup when a written last-eighth change blocks anticipation', () => {
 const { phrase } = buildListeningTuneSession({ tuneId: 'scenario-all-the-things-you-are', soloChoruses: 1 });
 const harmony = phrase.harmony.flatMap<typeof phrase.harmony[number]>(segment =>
  segment.startOffset[0] / segment.startOffset[1] === 17
   ? [{ ...segment, duration: [7, 8] },
      { ...segment, chord: { ...segment.chord, bass: 'Ab' as const }, startOffset: [143, 8], duration: [1, 8] }]
   : [segment]);
 const style = BACKING_STYLES['bossa-nova'];
 const params = { phraseId: phrase.id, tempo: 144, ppq: 192, beatsPerBar: 4,
  swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = { ...releasedBackingOptions('piano', 0), preparedPlayback: true as const };
 const score = createRollingBacking(harmony, style, params, options);
 const native = createRollingBacking(harmony, style, params, { ...options, eighthAnticipation: undefined });
 let nativeCheckpoint: RollingBackingCheckpoint | undefined;
 let checkpoint: RollingBackingCheckpoint | undefined;
 for (let bar = 0; bar <= 17; bar++) {
  const result = advanceRollingBacking(score, checkpoint);
  const ordinary = advanceRollingBacking(native, nativeCheckpoint);
  nativeCheckpoint = ordinary.checkpoint;
  if (bar === 17) {
   const pickup = result.bassEvents.find(event => event.absBeat === 71.5);
   expect(pickup).toBeDefined();
   expect(pickup).toEqual(ordinary.bassEvents.find(event => event.absBeat === 71.5));
   expect(pickup?.eighthAnticipatedRoot).toBeUndefined();
  }
  checkpoint = result.checkpoint;
 }
});
