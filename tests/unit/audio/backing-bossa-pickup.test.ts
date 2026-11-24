import { expect, it } from 'vitest';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';

for (const keyboard of ['piano', 'organ'] as const) {
 it(`answers the upright pickup in a full Bossa Blues with ${keyboard}`, () => {
  const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const params = { phraseId: phrase.id, sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm,
   tempo: 128, ppq: 192, beatsPerBar: 4, swing: .5, ensemble: {} };
  const options = releasedBackingOptions(keyboard, 3);
  const score = createRollingBacking(phrase.harmony, BACKING_STYLES['bossa-nova'], params, options);
  // The pre-pickup control predates melodic handoffs on the same Bossa offbeats.
  const oldScore = createRollingBacking(phrase.harmony, BACKING_STYLES['bossa-nova'], params, { ...options, bossaPickup: undefined, nativeMelodicHandoff: undefined });
  let checkpoint: RollingBackingCheckpoint | undefined, oldCheckpoint: RollingBackingCheckpoint | undefined;
  const answers: number[] = [];
  const pickupBars: number[] = [];
  for (let bar = 0; bar < score.totalBars; bar++) {
   const now = advanceRollingBacking(score, checkpoint), old = advanceRollingBacking(oldScore, oldCheckpoint);
   const pickup = now.bassEvents.find(e => e.bossaOctavePickup);
   expect(now.bassEvents.map(e => e.time)).toEqual(old.bassEvents.map(e => e.time));
   expect(now.drumEvents.filter(e => e.drum === 'crossstick')).toEqual(old.drumEvents.filter(e => e.drum === 'crossstick'));
   if (score.bars[bar].role === 'head') {
    expect(now.bassEvents).toEqual(old.bassEvents);
    expect(now.compEvents.map(e => e.absBeat)).toEqual(old.compEvents.map(e => e.absBeat));
    expect(now.drumEvents).toEqual(old.drumEvents);
   }
   if (pickup) {
    pickupBars.push(bar + 1);
    expect(now.checkpoint.bass.previousMidi).toBe(now.bassEvents.at(-1)!.midi);
    expect(now.checkpoint.bass.previousPreviousMidi).toBe(now.bassEvents.at(-2)!.midi);
    expect(pickup.absBeat).toBe(bar * 4 + 1.5);
    expect(now.bassEvents.find(e => e.absBeat === bar * 4 + 2)?.midi).toBe(pickup.midi - 12);
    expect(old.bassEvents.find(e => e.time === pickup.time)?.midi).toBe(pickup.midi - 12);
    const kick = now.drumEvents.find(e => e.drum === 'kick' && e.absBeat === pickup.absBeat)!;
    expect(kick.velocity).toBeGreaterThan(old.drumEvents.find(e => e.drum === 'kick' && e.time === kick.time)!.velocity);
    expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(now);
    const constrained = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0 }]);
    expect(constrained.bassEvents.some(e => e.bossaOctavePickup)).toBe(false);
   }
   const reply = now.compEvents.find(e => e.bossaReplyFrom !== undefined);
   if (reply) {
    expect(pickup).toBeDefined();
    expect(old.compEvents.some(e => e.absBeat === bar * 4 + reply.bossaReplyFrom!)).toBe(true);
    expect(reply.absBeat).toBeGreaterThan(bar * 4 + 2);
    expect(now.compEvents[0].absBeat).toBe(old.compEvents[0].absBeat);
    answers.push(bar + 1);
   }
   checkpoint = now.checkpoint;
   oldCheckpoint = old.checkpoint;
  }
  expect(pickupBars).toEqual(expect.arrayContaining([22, 34, 37]));
  expect(answers).toEqual(expect.arrayContaining([34, 37]));
 });
}

it('uses the drawn solo arc while retaining the pitches and pulse of the head', () => {
 const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const params = { phraseId: phrase.id, sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm,
  tempo: 128, ppq: 192, beatsPerBar: 4, swing: .5, ensemble: {} };
 const opportunities = (seed: number) => {
  const options = releasedBackingOptions('piano', seed);
  const score = createRollingBacking(phrase.harmony, BACKING_STYLES['bossa-nova'], params, options);
  const bars: number[] = [];
  let checkpoint: RollingBackingCheckpoint | undefined;
  for (let i = 0; i < score.totalBars; i++) {
   const result = advanceRollingBacking(score, checkpoint);
   if (result.bassEvents.some(e => e.bossaOctavePickup)) bars.push(i + 1);
   checkpoint = result.checkpoint;
  }
  return bars;
 };
 expect(opportunities(7)).toContain(19);
 expect(opportunities(3)).not.toContain(19);
 for (const style of ['swing', 'straight', 'ballad'] as const) {
  const options = releasedBackingOptions('piano', 3);
  const make = (enabled: true | undefined) => createRollingBacking(phrase.harmony, BACKING_STYLES[style], params,
   { ...options, bossaPickup: enabled });
  expect(make(true)).toEqual(make(undefined));
 }
});
