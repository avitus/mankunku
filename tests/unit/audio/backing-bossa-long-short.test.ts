import { expect, it } from 'vitest';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

it.each(['piano', 'organ'] as const)('plays a held chord and a clipped upbeat within the Bossa clave on %s (S6/P14)', instrument => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId: 'scenario-all-the-things-you-are', soloChoruses: 1 });
 const style = BACKING_STYLES['bossa-nova'];
 const params = { phraseId: phrase.id, tempo: 160, ppq: 192, beatsPerBar: 4, swing: style.defaultSwing,
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
 const options = releasedBackingOptions(instrument, 16);
 const score = createRollingBacking(phrase.harmony, style, params, options);
 const control = createRollingBacking(phrase.harmony, style, params, { ...options, bossaLongShort: undefined });
 let checkpoint: RollingBackingCheckpoint | undefined;
 let prior: RollingBackingCheckpoint | undefined;
 const landmarks: number[] = [];
 for (const bar of bars) {
  const played = advanceRollingBacking(score, checkpoint);
  const old = advanceRollingBacking(control, prior);
  expect(played.drumEvents).toEqual(old.drumEvents);
  expect(played.bassEvents).toEqual(old.bassEvents);
  if (played.compEvents.some(e => e.bossaLongShort)) {
   expect(played.compEvents.map(e => e.absBeat % 4)).toEqual([1, 2.5]);
   expect(played.compEvents.map(e => e.bossaLongShort)).toEqual(['hold', 'clip']);
   const [hold, clip] = played.compEvents;
   expect(hold.duration).toBeGreaterThan(clip.duration * 3);
   expect(hold.duration).toBeGreaterThan(old.compEvents[0].duration);
   expect(clip.duration).toBeLessThan(old.compEvents[1].duration);
   expect(played.compEvents.map(e => [e.notes, e.time, e.velocity])).toEqual(old.compEvents.map(e => [e.notes, e.time, e.velocity]));
   expect(bar.context.role).toBe('head');
   expect(advanceRollingBacking(score, checkpoint && JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar.barIndex, observedAtBar: bar.barIndex, confidence: 1, noteDensity: 1, restBeats: 0 }]);
   expect(busy.compEvents.some(e => e.bossaLongShort)).toBe(false);
   landmarks.push(bar.barNumber);
  }
  checkpoint = played.checkpoint;
  prior = old.checkpoint;
 }
 expect(landmarks).toEqual([3, 11, 25, 83]);
 const prepared = prepareReleasedArrangement(phrase.harmony, style, params, instrument, 4, 16);
 expect(prepared.compEvents.filter(e => e.bossaLongShort === 'clip').map(e => Math.floor(e.absBeat / 4) + 1)).toEqual(landmarks);
});
