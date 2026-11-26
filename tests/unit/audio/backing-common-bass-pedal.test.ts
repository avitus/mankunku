import { expect, it } from 'vitest';
import { RHYTHM_CHANGES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { pitchClassToNumber } from '$lib/audio/voicings';

it.each(['piano', 'organ'] as const)('repeats a sounding minor root as the dominant fifth under %s (B12/B45)', instrument => {
 const { phrase, bars } = buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 1 });
 const style = BACKING_STYLES.swing;
 const params = { phraseId: phrase.id, tempo: 160, ppq: 192, beatsPerBar: 4, swing: .62,
  performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
 const options = releasedBackingOptions(instrument, 0);
 const score = createRollingBacking(phrase.harmony, style, params, options);
 const prior = createRollingBacking(phrase.harmony, style, params, { ...options, commonBassPedal: undefined });
 let oldCheckpoint: RollingBackingCheckpoint | undefined;
 let checkpoint: RollingBackingCheckpoint | undefined;
 const landmarks: number[] = [];
 for (const bar of bars) {
  const played = advanceRollingBacking(score, checkpoint);
  const old = advanceRollingBacking(prior, oldCheckpoint);
  oldCheckpoint = old.checkpoint;
  const pedal = played.bassEvents.find(e => e.commonBassPedal);
  if (pedal) {
   const [first, third] = played.bassEvents;
   expect(played.bassEvents).toHaveLength(2);
   expect([first.absBeat % 4, third.absBeat % 4]).toEqual([0, 2]);
   expect(first.midi).toBe(third.midi);
   expect(old.bassEvents).toHaveLength(2);
   expect(old.bassEvents[1].midi).not.toBe(third.midi);
   expect(played.bassEvents.map(e => [e.time, e.duration, e.velocity])).toEqual(old.bassEvents.map(e => [e.time, e.duration, e.velocity]));
   expect(played.compEvents.some(e => e.absBeat >= third.absBeat)).toBe(true);
   const chords = phrase.harmony.slice(played.checkpoint.bass.segmentIndex! - 1, played.checkpoint.bass.segmentIndex! + 1);
   expect(chords.map(s => s.chord.quality)).toEqual(['min7', '7']);
   expect(first.midi % 12).toBe(pitchClassToNumber(chords[0].chord.root));
   expect(third.midi % 12).toBe((pitchClassToNumber(chords[1].chord.root) + 7) % 12);
   expect(bar.context.role).toBe('head');
   expect(played.checkpoint.bass.previousMidi).toBe(pedal.midi);
   expect(played.checkpoint.bass.segmentAnchor).toBe(pedal.midi);
   expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(checkpoint)))).toEqual(played);
   const busy = advanceRollingBacking(score, checkpoint, [{ source: 'scripted', barIndex: bar.barIndex, observedAtBar: bar.barIndex, confidence: 1, noteDensity: 1, restBeats: 0 }]);
   expect(busy.bassEvents.some(e => e.commonBassPedal)).toBe(false);
   landmarks.push(bar.barNumber);
  }
  checkpoint = played.checkpoint;
 }
 expect(landmarks).toEqual([5, 91]);
 const prepared = prepareReleasedArrangement(phrase.harmony, style, params, instrument, 4, 0);
 expect(prepared.bassEvents.filter(e => e.commonBassPedal).map(e => [e.absBeat, e.midi])).toEqual([[18, 41], [362, 38]]);
});
