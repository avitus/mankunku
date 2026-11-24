import { expect, it } from 'vitest';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';

it('plays a complete quarter-note triplet against the walking pulse and resolves on three', () => {
 const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const style = BACKING_STYLES.swing;
 const options = releasedBackingOptions('piano', 2);
 const settings = { phraseId: phrase.id, tempo: 128, ppq: 192, beatsPerBar: 4,
  swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const score = createRollingBacking(phrase.harmony, style, settings, options);
 const baseline = createRollingBacking(phrase.harmony, style, settings, { ...options, rideTriplet: undefined });
 let historical: RollingBackingCheckpoint | undefined;
 let checkpoint: RollingBackingCheckpoint | undefined;
 const landmarks: number[] = [];
 for (let bar = 0; bar < score.totalBars; bar++) {
  const played = advanceRollingBacking(score, checkpoint);
  const control = advanceRollingBacking(baseline, historical);
  historical = control.checkpoint;
  expect(played.bassEvents).toEqual(control.bassEvents);
  expect(played.compEvents).toEqual(control.compEvents);
  const triplet = played.drumEvents.filter(hit => hit.rideTriplet);
  if (triplet.length) {
   const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0 }]);
   expect(busy.drumEvents.some(hit => hit.rideTriplet)).toBe(false);
   const unaffected = (hit: typeof triplet[number]) => hit.drum !== 'ride' || hit.absBeat >= bar*4+2;
   expect(played.drumEvents.filter(unaffected)).toEqual(control.drumEvents.filter(unaffected));
   landmarks.push(bar + 1);
   expect(score.bars[bar].role).toBe('solo');
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   expect(triplet.map(e => e.absBeat)).toEqual([0, 2/3, 4/3].map(offset => bar*4 + offset));
   const ride = played.drumEvents.filter(e => e.drum === 'ride');
   expect(ride.filter(e => e.absBeat < bar*4+2)).toEqual(triplet);
   expect(ride.some(e => e.absBeat === bar*4+2)).toBe(true);
   for (const [i,e] of triplet.entries()) {
    expect(Math.abs(parseInt(e.time) - (bar*4*192+i*128))).toBeLessThan(12);
   }
   expect(played.bassEvents.filter(e => e.absBeat < bar*4+2).map(e => e.absBeat)).toContain(bar*4+1);
  } else expect(played.drumEvents).toEqual(control.drumEvents);
  checkpoint = played.checkpoint;
 }
 expect(landmarks).toEqual([18, 31]);
});
