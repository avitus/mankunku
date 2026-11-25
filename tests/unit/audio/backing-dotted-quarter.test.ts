import { expect, it } from 'vitest';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';

it.each(['piano', 'organ'] as const)('the %s continues a heard dotted-quarter pair across a Straight solo bar line (S6/P8)', instrument => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId: 'scenario-fly-me-to-the-moon', soloChoruses: 1 });
 const style = BACKING_STYLES.straight;
 const settings = { phraseId: phrase.id, tempo: 144, ppq: 192,
  beatsPerBar: 4, swing: style.defaultSwing, performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = releasedBackingOptions(instrument, 11);
 const score = createRollingBacking(phrase.harmony, style, settings, options);
 const control = createRollingBacking(phrase.harmony, style, settings, { ...options, dottedQuarterComp: undefined });
 let oldCheckpoint: RollingBackingCheckpoint | undefined;
 let checkpoint: RollingBackingCheckpoint | undefined;
 let previous: number[] = [];
 const landmarks: number[] = [];
 for (const bar of bars) {
  const played = advanceRollingBacking(score, checkpoint);
  const old = advanceRollingBacking(control, oldCheckpoint);
  oldCheckpoint = old.checkpoint;
  expect(old.ensembleDevelopment.pianoMotifs.some(trace => trace.reason === 'dotted_quarter')).toBe(false);
  const notes = played.compEvents.map(event => event.absBeat);
  if (played.ensembleDevelopment.pianoMotifs.some(trace => trace.reason === 'dotted_quarter')) {
   if (landmarks.length === 0) {
    expect(old.compEvents).toHaveLength(2);
    expect(notes).not.toEqual(old.compEvents.map(event => event.absBeat));
    expect(played.bassEvents).toEqual(old.bassEvents);
   }
   expect(bar.context.role).toBe('solo');
   expect(notes).toHaveLength(2);
   expect(previous).toHaveLength(2);
   const attacks = [...previous, ...notes];
   expect(attacks.slice(1).map((beat, i) => beat - attacks[i])).toEqual([1.5, 1.5, 1.5]);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar.barIndex,
    observedAtBar: bar.barIndex, confidence: 1, noteDensity: 1, restBeats: 0 }]);
   expect(busy.ensembleDevelopment.pianoMotifs.some(trace => trace.reason === 'dotted_quarter')).toBe(false);
   landmarks.push(bar.barNumber);
  }
  previous = notes;
  checkpoint = played.checkpoint;
 }
 expect(landmarks).toEqual(instrument === 'piano' ? [52, 55] : [46, 52, 55]);
});
