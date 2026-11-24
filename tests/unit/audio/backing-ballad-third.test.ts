import { it, expect } from 'vitest';
import { PITCH_CLASSES } from '$lib/types/music';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';

for (const keyboard of ['piano', 'organ'] as const) {
 it(`lets the Ballad bass and rim speak before the ${keyboard} answers on four`, () => {
  const { phrase, bars } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const style = BACKING_STYLES.ballad;
  const params = { phraseId: phrase.id, tempo: 92, swing: style.defaultSwing, ppq: 192, beatsPerBar: 4,
   performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
  const options = releasedBackingOptions(keyboard, 3);
  const score = createRollingBacking(phrase.harmony, style, params, options);
  const oldOptions = { ...options, balladThird: undefined };
  for (const name of ['swing', 'straight', 'bossa-nova'] as const) {
   expect(createRollingBacking(phrase.harmony, BACKING_STYLES[name], params, options))
    .toEqual(createRollingBacking(phrase.harmony, BACKING_STYLES[name], params, oldOptions));
  }
  const oldScore = createRollingBacking(phrase.harmony, style, params, oldOptions);
  let oldCp: RollingBackingCheckpoint | undefined;
  const landmarks: number[] = [];
  let cp: RollingBackingCheckpoint | undefined;
  for (let bar = 0; bar < score.totalBars; bar++) {
   const r = advanceRollingBacking(score, cp);
   const old = advanceRollingBacking(oldScore, oldCp);
   oldCp = old.checkpoint;
   if (bar < 16) {
    expect(r.bassEvents).toEqual(old.bassEvents);
    expect(r.compEvents).toEqual(old.compEvents);
    expect(r.drumEvents).toEqual(old.drumEvents);
   }
   const third = r.bassEvents.find(e => e.balladThird);
   const chord = r.compEvents.find(e => e.balladThird);
   const rim = r.drumEvents.find(e => e.balladThird);
   if (third) {
    expect(['solo_peak','solo_build']).toContain(r.ensemblePlan.bars[0].performanceEnergy?.phase);
    expect(r.bassEvents.map(e => e.absBeat % 4)).toEqual([0,2]);
    expect(bars[bar].changes).toHaveLength(1);
    expect(bars[bar].changes[0].durationBeats).toBe(4);
    const written = phrase.harmony[r.checkpoint.bass.segmentIndex!].chord;
    expect(r.bassEvents[0].midi % 12).toBe(PITCH_CLASSES.indexOf(written.root));
    expect(third.midi - r.bassEvents[0].midi).toBe(written.quality === 'dim7' || written.quality.startsWith('min') ? 3 : 4);
    expect(() => advanceRollingBacking(oldScore, r.checkpoint)).toThrow();
    expect(r.checkpoint.bass.previousMidi).toBe(third.midi);
    expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(cp)))).toEqual(r);
    const busy = advanceRollingBacking(score, cp, [{ source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0 }]);
    expect(busy.bassEvents.some(e => e.balladThird)).toBe(false);
   }
   if (chord) {
    expect(third).toBeDefined();
    expect(r.compEvents.map(e => e.absBeat % 4)).toEqual([0,3]);
    expect(r.compEvents[0].duration * params.tempo / 60).toBeGreaterThan(2);
    expect(chord.duration * params.tempo / 60).toBeLessThan(.85);
   }
   if (rim) {
    expect(third).toBeDefined();
    expect(rim.absBeat).toBe(third!.absBeat);
    expect(rim.drum).toBe('crossstick');
    expect(r.drumEvents.filter(e => e.role === 'commentary')).toEqual([rim]);
    expect(r.drumEvents.filter(e => e.drum === 'ride')).toHaveLength(4);
    if (chord) landmarks.push(bar + 1);
   }
   cp = r.checkpoint;
  }
  expect(landmarks).toEqual([21, 22, 30]);
  const prepared = prepareReleasedArrangement(phrase.harmony, style, params, keyboard, 4, 3);
  for (const n of landmarks) expect(prepared.compEvents.some(e => e.absBeat === n * 4 - 1 && e.balladThird)).toBe(true);
 });
}
