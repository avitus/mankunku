import { expect, it } from 'vitest';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

it.each(['piano', 'organ'] as const)('lets the foot hat carry a quiet Ballad passage under %s (S19/D18, D20)', instrument => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 1 });
 const style = BACKING_STYLES.ballad;
 const params = { phraseId: phrase.id, tempo: 92, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
 const options = releasedBackingOptions(instrument, 9);
 const score = createRollingBacking(phrase.harmony, style, params, options);
 const control = createRollingBacking(phrase.harmony, style, params, { ...options, quarterPedal: undefined });
 for (const other of ['swing', 'straight', 'bossa-nova'] as const) {
  expect(createRollingBacking(phrase.harmony, BACKING_STYLES[other], params, options))
   .toEqual(createRollingBacking(phrase.harmony, BACKING_STYLES[other], params, { ...options, quarterPedal: undefined }));
 }
 let checkpoint: RollingBackingCheckpoint | undefined;
 let previous: RollingBackingCheckpoint | undefined;
 const landmarks: number[] = [];
 for (const bar of bars) {
  const played = advanceRollingBacking(score, checkpoint);
  const old = advanceRollingBacking(control, previous);
  expect(played.compEvents).toEqual(old.compEvents);
  expect(played.bassEvents).toEqual(old.bassEvents);
  const hats = played.drumEvents.filter(e => e.drum === 'hihat-pedal');
  if (hats.length === 4) {
   expect(bar.context.role).toBe('head');
   expect(hats.map(e => e.absBeat % 4).sort()).toEqual([0, 1, 2, 3]);
   expect(played.drumEvents.filter(e => e.drum === 'ride')).toHaveLength(0);
   expect(old.drumEvents.filter(e => e.drum === 'ride')).toHaveLength(4);
   expect(old.drumEvents.filter(e => e.drum === 'hihat-pedal')).toHaveLength(2);
   expect(played.drumEvents.filter(e => !['ride', 'hihat-pedal'].includes(e.drum)))
    .toEqual(old.drumEvents.filter(e => !['ride', 'hihat-pedal'].includes(e.drum)));
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar.barIndex,
    observedAtBar: bar.barIndex, confidence: 1, noteDensity: 1, restBeats: 0 }]);
   expect(busy.drumEvents.filter(e => e.drum === 'hihat-pedal')).toHaveLength(2);
   landmarks.push(bar.barNumber);
  } else expect(played.drumEvents).toEqual(old.drumEvents);
  previous = old.checkpoint;
  checkpoint = played.checkpoint;
 }
 expect(landmarks).toEqual([6, 7, 30, 31]);
});
