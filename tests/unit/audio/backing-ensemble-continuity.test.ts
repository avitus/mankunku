import { expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES, RHYTHM_CHANGES } from '$lib/data/tunes';

for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] as const) {
 for (const instrument of ['piano', 'organ'] as const) {
  it(`${style} ${instrument} keeps the trio present through full performances`, () => {
   const failures: string[] = [];
   for (const tune of [MANKUNKU_BLUES, RHYTHM_CHANGES]) {
    const { phrase } = buildListeningTuneSession({ tuneId: tune.id, soloChoruses: 2 });
    for (const tempo of style === 'ballad' ? [70, 95] : [120, 140]) {
     for (const seed of [0, 3, 4, 5, 7, 10, 21, 37, 48, 50, 63, 127]) {
      const score = createRollingBacking(phrase.harmony, BACKING_STYLES[style], {
       phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: style === 'swing' ? .62 : .5,
       performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
      }, releasedBackingOptions(instrument, seed));
      let previous: RollingBackingCheckpoint | undefined;
      let missing = 0;
      const reasons: string[] = [];
      for (let bar = 0; bar < score.totalBars; bar++) {
       const window = advanceRollingBacking(score, previous);
       previous = window.checkpoint;
       const reason = window.ensembleDevelopment.pianoMotifs[0].reason;
       if (window.compEvents.length) { missing = 0; reasons.length = 0; }
       else { missing++; reasons.push(window.ensemblePlan.bars[0].piano.silenceReason ?? reason ?? 'unexplained'); }
       if (!window.bassEvents.length || !window.drumEvents.length || missing >= 4)
        failures.push(`${tune.id} ${tempo} seed ${seed} bar ${bar+1} bass ${window.bassEvents.length} drums ${window.drumEvents.length} keys silent ${missing} ${reasons.join(',')}`);
      }
     }
    }
   }
   expect(failures).toEqual([]);
  });
 }
}

for (const instrument of ['piano', 'organ'] as const) {
 it(`Ballad ${instrument} voices the beat-three chord when a whole pad would leave it open`, () => {
  const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const params = { phraseId: phrase.id, tempo: 80, swing: .5, ppq: 192, beatsPerBar: 4,
   performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
  const options = releasedBackingOptions(instrument, 3);
  const current = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, params, options);
  const old = createRollingBacking(phrase.harmony, BACKING_STYLES.ballad, params, {...options, keyboardSustain:'common-tones'});
  let prior: RollingBackingCheckpoint | undefined, legacy: RollingBackingCheckpoint | undefined;
  const witnesses: number[] = [];
  for (let bar = 0; bar < current.totalBars; bar++) {
   const result = advanceRollingBacking(current, prior), baseline = advanceRollingBacking(old, legacy);
   const beatThree = bar * 4 + 2;
   if (baseline.compEvents.length === 1 && baseline.compEvents[0].absBeat === bar * 4 &&
    result.compEvents.some(event => event.absBeat === beatThree)) {
    expect(result.compEvents[0].absBeat).toBe(bar * 4);
    expect(result.compEvents.find(e => e.absBeat === beatThree)!.notes).not.toEqual(result.compEvents[0].notes);
    expect(advanceRollingBacking(current, prior && JSON.parse(JSON.stringify(prior)))).toEqual(result);
    witnesses.push(bar + 1);
   }
   prior = result.checkpoint; legacy = baseline.checkpoint;
  }
  // Keep the audible landmarks advertised for this specific release example.
  expect(witnesses).toEqual(expect.arrayContaining([8, 15, 16]));
 });
}
