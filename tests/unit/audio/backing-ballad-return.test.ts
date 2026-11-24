import { expect, it } from 'vitest';
import { MANKUNKU_BLUES, RHYTHM_CHANGES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';

for (const keyboard of ['piano', 'organ'] as const) {
 it(`hands the half-note pulse to the ${keyboard} when the Ballad head returns`, () => {
  const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const params = { phraseId: phrase.id, sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm,
   tempo: 80, ppq: 192, beatsPerBar: 4, swing: BACKING_STYLES.ballad.defaultSwing, ensemble: {} };
  const options = releasedBackingOptions(keyboard, 3);
  const prior = { ...options, balladReturn: undefined };
  for (const style of ['swing', 'straight', 'bossa-nova'] as const) {
   expect(createRollingBacking(phrase.harmony, BACKING_STYLES[style], params, options))
    .toEqual(createRollingBacking(phrase.harmony, BACKING_STYLES[style], params, prior));
  }
  const score = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, params, options);
  const oldScore = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, params, prior);
  let checkpoint: RollingBackingCheckpoint | undefined, oldCheckpoint: RollingBackingCheckpoint | undefined;
  const handoffs: number[] = [];
  for (let bar = 0; bar < score.totalBars; bar++) {
   const now = advanceRollingBacking(score, checkpoint), old = advanceRollingBacking(oldScore, oldCheckpoint);
   if (bar < 40) {
    expect(now.bassEvents).toEqual(old.bassEvents);
    expect(now.compEvents).toEqual(old.compEvents);
    expect(now.drumEvents).toEqual(old.drumEvents);
   }
   if (now.bassEvents.some(e => e.balladHeldBass)) {
    expect(now.ensemblePlan.bars[0].performanceEnergy?.phase).toBe('head_return');
    expect(now.bassEvents).toHaveLength(1);
    expect(now.bassEvents[0].duration * 80 / 60).toBeGreaterThan(3);
    expect(now.checkpoint.bass.previousMidi).toBe(now.bassEvents[0].midi);
    expect(now.checkpoint.bass.previousPreviousMidi).toBe(checkpoint!.bass.previousMidi);
    expect(now.bassEvents[0].time).toBe(old.bassEvents[0].time);
    expect(now.drumEvents.filter(e => e.drum === 'ride').map(e => e.absBeat % 4)).toEqual([0, 2]);
    expect(now.drumEvents.filter(e => e.drum === 'hihat-pedal').map(e => e.absBeat % 4)).toEqual([1, 3]);
    expect(now.drumEvents.filter(e => e.drum === 'hihat-pedal')).toEqual(old.drumEvents.filter(e => e.drum === 'hihat-pedal'));
    expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(now);
    const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar, observedAtBar: bar,
     confidence: 1, noteDensity: 1, restBeats: 0 }]);
    expect(busy.bassEvents.some(e => e.balladHeldBass)).toBe(false);
   }
   if (now.compEvents.some(e => e.balladReturnAnswer)) {
    expect(now.bassEvents[0].balladHeldBass).toBe(true);
    expect(now.compEvents.map(e => e.absBeat % 4)).toEqual([0, 2]);
    expect(old.compEvents.map(e => e.absBeat % 4)).toEqual([0]);
    handoffs.push(bar + 1);
   }
   checkpoint = now.checkpoint;
   oldCheckpoint = old.checkpoint;
  }
  expect(handoffs).toEqual(expect.arrayContaining([47, 48]));
 });
}

it('respects the faster harmonic rhythm of Rhythm Changes with a different form and arc', () => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 1 });
 const score = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, { phraseId: phrase.id, tempo: 92,
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ppq: 192, beatsPerBar: 4,
  swing: BACKING_STYLES.ballad.defaultSwing, ensemble: {} }, releasedBackingOptions('piano', 7));
 let checkpoint: RollingBackingCheckpoint | undefined;
 let splitBars = 0, heldBars = 0;
 for (const bar of bars) {
  const result = advanceRollingBacking(score, checkpoint);
  checkpoint = result.checkpoint;
  const hold = result.bassEvents.find(e => e.balladHeldBass);
  if (hold) {
   heldBars++;
   expect(bar.changes).toHaveLength(1);
   expect(bar.changes[0].durationBeats).toBe(4);
  }
  if (result.ensemblePlan.bars[0].performanceEnergy?.phase === 'head_return' && bar.changes.length > 1) {
   splitBars++;
   expect(hold).toBeUndefined();
   expect(result.drumEvents.filter(e => e.drum === 'ride')).toHaveLength(4);
  }
 }
 expect(splitBars).toBeGreaterThan(0);
 expect(heldBars).toBeGreaterThan(0);
});
