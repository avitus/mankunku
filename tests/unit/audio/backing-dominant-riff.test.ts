import { expect, it } from 'vitest';
import { RHYTHM_CHANGES } from '$lib/data/tunes';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';

for (const keyboard of ['piano', 'organ'] as const) {
 it(`sets up a recurring Charleston across the solo bridge of Rhythm Changes with ${keyboard}`, () => {
  const { phrase } = buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 1 });
  const tempo = 176, style = BACKING_STYLES.swing;
  const params = { phraseId: phrase.id, sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm,
   tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.5, style, tempo), ensemble: {} };
  const options = releasedBackingOptions(keyboard, 3);
  const oldOptions = { ...options, dominantRiff: undefined };
  const score = createRollingBacking(phrase.harmony, style, params, options);
  for (const other of ['straight', 'bossa-nova', 'ballad'] as const) {
   expect(createRollingBacking(phrase.harmony, BACKING_STYLES[other], params, options))
    .toEqual(createRollingBacking(phrase.harmony, BACKING_STYLES[other], params, oldOptions));
  }
  const old = createRollingBacking(phrase.harmony, style, params, oldOptions);
  let cp: RollingBackingCheckpoint | undefined, prior: RollingBackingCheckpoint | undefined;
  const trio: number[] = [];
  for (let bar = 0; bar < score.totalBars; bar++) {
   const r = advanceRollingBacking(score, cp), legacy = advanceRollingBacking(old, prior);
   if (bar < 48) {
    expect(r.compEvents).toEqual(legacy.compEvents);
    expect(r.bassEvents).toEqual(legacy.bassEvents);
    expect(r.drumEvents).toEqual(legacy.drumEvents);
   }
   const pickup = r.bassEvents.find(e => e.dominantRiff);
   const keys = r.compEvents.filter(e => e.dominantRiff);
   const bell = r.drumEvents.find(e => e.dominantRiff);
   if (pickup) {
    expect([49, 51, 53, 55]).toContain(bar + 1);
    expect(r.bassEvents.map(e => e.absBeat % 4)).toEqual([0, 1.5, 3]);
    expect(r.checkpoint.bass.previousPreviousMidi).toBe(pickup.midi);
    expect(r.checkpoint.bass.previousMidi).toBe(r.bassEvents[2].midi);
    expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(cp)))).toEqual(r);
    const busy = advanceRollingBacking(score, cp, [{ source: 'scripted', barIndex: bar, observedAtBar: bar, confidence: 1, noteDensity: 1, restBeats: 0 }]);
    expect(busy.bassEvents.some(e => e.dominantRiff)).toBe(false);
   }
   if (keys.length || bell) expect(pickup).toBeDefined();
   if (keys.length) {
    expect([...new Set(keys.map(e => e.absBeat % 4))]).toEqual([0, 1.5]);
    expect(keys.find(e => e.absBeat % 4 === 1.5)!.duration * tempo / 60).toBeLessThan(.8);
    expect(r.ensembleDevelopment.pianoMotifs[0].sourceFigureId).toBe('charleston');
   }
   if (bell) {
    expect(bell.drum).toBe('ride-bell');
    expect(bell.absBeat).toBe(pickup!.absBeat);
    expect(r.drumEvents.some(e => e.drum === 'ride' && e.absBeat === bell.absBeat)).toBe(false);
    if (keys.length) trio.push(bar + 1);
   }
   cp = r.checkpoint; prior = legacy.checkpoint;
  }
  expect(trio).toEqual([51, 53, 55]);
  const prepared = prepareReleasedArrangement(phrase.harmony, style, params, keyboard, 4, 3);
  expect(prepared.drumEvents.filter(e => e.dominantRiff).map(e => Math.floor(e.absBeat / 4) + 1)).toEqual(trio);
  const practice = prepareReleasedArrangement(phrase.harmony, style, { ...params, performanceForm: undefined }, keyboard, 4, 3);
  expect(practice.bassEvents.some(e => e.dominantRiff)).toBe(false);
 });
}

it('recognizes a reprinted dominant and yields when its second bar changes harmony', () => {
 const { phrase } = buildListeningTuneSession({ tuneId: RHYTHM_CHANGES.id, soloChoruses: 1 });
 const start = 50;
 const rendered = (changed: boolean) => {
  const harmony = phrase.harmony.flatMap(segment => {
   if (segment.startOffset[0] / segment.startOffset[1] !== start) return [segment];
   return [{ ...segment, duration: [1, 1] as [number, number] },
    { ...segment, startOffset: [start + 1, 1] as [number, number], duration: [1, 1] as [number, number],
     chord: changed ? { ...segment.chord, root: 'C' as const } : segment.chord }];
  });
  const score = createRollingBacking(harmony, BACKING_STYLES.swing, { phraseId: phrase.id, sectionMap: phrase.sectionMap,
   performanceForm: phrase.performanceForm, tempo: 176, ppq: 192, beatsPerBar: 4, swing: .62, ensemble: {} }, releasedBackingOptions('piano', 3));
  let cp: RollingBackingCheckpoint | undefined;
  const bars: number[] = [];
  for (let bar = 0; bar <= start + 1; bar++) {
   const result = advanceRollingBacking(score, cp);
   cp = result.checkpoint;
   if (result.bassEvents.some(e => e.dominantRiff)) bars.push(bar);
  }
  return bars;
 };
 const repeated = rendered(false);
 expect(repeated).toContain(start);
 expect(repeated).not.toContain(start + 1);
 expect(rendered(true)).not.toContain(start);
});
