import { expect, it } from 'vitest';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';

it.each([
 ['scenario-fly-me-to-the-moon', [[3, 36], [23, 33], [92, 38]]],
 ['scenario-all-the-things-you-are', [[3, 32], [6, 36], [22, 40], [27, 32], [94, 40]]]
] as const)('anticipates selected written resolutions in the full Swing heads of %s (S12/B6)', (tuneId, expected) => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId, soloChoruses: 1 });
 const style = BACKING_STYLES.swing;
 const settings = { phraseId: phrase.id, tempo: 144, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
  performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = releasedBackingOptions('piano', 7);
 const score = createRollingBacking(phrase.harmony, style, settings, options);
 const baseline = createRollingBacking(phrase.harmony, style, settings, { ...options, quarterAnticipation: undefined });
 let checkpoint: RollingBackingCheckpoint | undefined;
 let historical: RollingBackingCheckpoint | undefined;
 const landmarks = [];
 for (let bar = 0; bar < bars.length; bar++) {
  const played = advanceRollingBacking(score, checkpoint);
  const control = advanceRollingBacking(baseline, historical);
  const pickup = played.bassEvents.find(event => event.anticipatedRoot);
  if (pickup) {
   expect(bars[bar].context.role).toBe('head');
   expect(played.bassEvents.map(event => event.absBeat - bar * 4)).toEqual([0, 2, 3]);
   expect(control.bassEvents.map(event => event.absBeat - bar * 4)).toEqual([0, 2]);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   expect(played.checkpoint.bass.previousMidi).toBe(pickup.midi);
   const next = advanceRollingBacking(score, played.checkpoint).bassEvents[0];
   expect([next.absBeat, next.midi]).toEqual([(bar + 1) * 4, pickup.midi]);
   const busy = advanceRollingBacking(score, checkpoint, [{
    source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0
   }]);
   expect(busy.bassEvents.some(event => event.anticipatedRoot)).toBe(false);
   landmarks.push([bar + 1, pickup.midi]);
  }
  checkpoint = played.checkpoint;
  historical = control.checkpoint;
 }
 expect(landmarks).toEqual(expected);
});
