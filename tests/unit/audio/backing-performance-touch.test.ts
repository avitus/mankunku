import { createHash } from 'node:crypto';
// Event hashes match both 0.20.0 (d95bebad) and pre-promotion dev (62450e2a).
// Full-bar hashes include dev’s corrected common-tone voicing diagnostics.
import baseline from '../../fixtures/musicality-020-walking-baseline.json';
import { expect, it } from 'vitest';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
 for (const keyboard of ['piano', 'organ'] as const) {
  it(`shapes the walking trio through a complete ${style} Blues with ${keyboard}`, () => {
   const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
   const params = { phraseId: phrase.id, sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm,
    tempo: 140, ppq: 192, beatsPerBar: 4, swing: .62, ensemble: {} };
   const options = { ...releasedBackingOptions(keyboard, 3), commonBassPedal: undefined, quarterPedal: undefined, dottedQuarterComp: undefined, eighthAnticipation: undefined, quarterAnticipation: undefined, rideTriplet: undefined, rhythmMemory: undefined, balladThird: undefined, brokenTwo: undefined, dominantRiff: undefined, balladReturn: undefined, bossaPickup: undefined };
   const current = createRollingBacking(phrase.harmony, BACKING_STYLES[style], params, options);
   const old = createRollingBacking(phrase.harmony, BACKING_STYLES[style], params, { ...options, performanceTouch: undefined });
   const oldHash = createHash('sha256');
   const oldEvents = createHash('sha256');
   let checkpoint: RollingBackingCheckpoint | undefined, legacy: RollingBackingCheckpoint | undefined;
   const bassBars: number[] = [], keyBars: number[] = [], rideBars: number[] = [];
   const gateBeats: number[] = [], keyLift: number[] = [], rideLift: number[] = [];
   for (let bar = 0; bar < current.totalBars; bar++) {
    const result = advanceRollingBacking(current, checkpoint);
    const prior = advanceRollingBacking(old, legacy);
    oldHash.update(JSON.stringify(prior));
    oldEvents.update(JSON.stringify([prior.bassEvents, prior.compEvents, prior.drumEvents]));
    if (style === 'bossa-nova' || style === 'ballad') expect(result).toEqual(prior);
    else {
     expect(result.bassEvents.map(e => [e.midi,e.time])).toEqual(prior.bassEvents.map(e => [e.midi,e.time]));
     expect(result.compEvents.map(e => [e.notes,e.time,e.duration])).toEqual(prior.compEvents.map(e => [e.notes,e.time,e.duration]));
     expect(result.drumEvents.map(e => [e.drum,e.time])).toEqual(prior.drumEvents.map(e => [e.drum,e.time]));
     const gates = result.bassEvents.filter((e,i) => e.duration !== prior.bassEvents[i].duration);
     const chords = result.compEvents.filter((e,i) => e.velocity !== prior.compEvents[i].velocity);
     const ride = result.drumEvents.filter((e,i) => e.velocity !== prior.drumEvents[i].velocity);
     for (const event of gates) gateBeats.push(event.duration * params.tempo / 60);
     for (const e of chords) keyLift.push(e.velocity - prior.compEvents[result.compEvents.indexOf(e)].velocity);
     for (const e of ride) rideLift.push(e.velocity - prior.drumEvents[result.drumEvents.indexOf(e)].velocity);
     if (style === 'swing' && keyboard === 'piano' && [15,26,30,31,33,36].includes(bar)) {
      console.log('AUDITION_BAR', bar + 1, JSON.stringify({ energy: result.ensemblePlan.bars[0].performanceEnergy,
       bassMs: gates[0] && Math.round(gates[0].duration * 1000),
       chords: chords.map(e => [e.absBeat % 4 + 1, e.velocity]), ride: ride.map(e => [e.absBeat % 4 + 1, e.velocity]) }));
     }
     if (gates.length) { expect(gates.every(e => Number.isInteger(e.absBeat))).toBe(true); bassBars.push(bar+1); }
     if (chords.length) { expect(chords.every(e => e.absBeat % 1 === .5)).toBe(true); keyBars.push(bar+1); }
     if (ride.length) { expect(ride.every(e => e.drum === 'ride' && e.absBeat % 2 === 1)).toBe(true); rideBars.push(bar+1); }
     if (bar === 26 || bar === 33) expect(advanceRollingBacking(current, JSON.parse(JSON.stringify(checkpoint)))).toEqual(result);
    }
    checkpoint = result.checkpoint; legacy = prior.checkpoint;
   }
   const reference = baseline[`${style}/${keyboard}`];
   expect(oldHash.digest('hex')).toBe(reference.fullBar);
   expect(oldEvents.digest('hex')).toBe(reference.events);
   if (style === 'swing' || style === 'straight') {
    console.log('WALKING_TOUCH',style,keyboard,{bassBars,keyBars,rideBars});
    for (const bars of [bassBars,keyBars,rideBars]) expect(bars).toEqual(expect.arrayContaining([27,31,32,34]));
    expect(Math.max(...gateBeats) - Math.min(...gateBeats)).toBeGreaterThan(.12);
    expect(Math.max(...keyLift) - Math.min(...keyLift)).toBeGreaterThan(3);
    expect(Math.max(...rideLift) - Math.min(...rideLift)).toBeGreaterThan(.04);
   }
  });
 }
}
