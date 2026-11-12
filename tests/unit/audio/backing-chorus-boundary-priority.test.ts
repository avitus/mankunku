import { describe, expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { planEnsembleWindow } from '$lib/audio/ensemble-plan';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';

function fixture(priority = false, seed = 42, loops = 1, style: 'swing' | 'straight' | 'bossa-nova' | 'ballad' = 'swing', aaba = false) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 const session = aaba ? admitted.session : buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
 const { phrase } = session;
 return createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
  phraseId: seed === 42 ? phrase.id : `${phrase.id}:boundary:${seed}`, tempo: style === 'ballad' ? 80 : 140,
  ppq: 192, beatsPerBar: 4, swing: style === 'swing' ? .67 : .5,
  sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
 }, { returningMelodySpace: true, pianoPresence: 'accompaniment', keyboardVariety: true,
  performanceEnergySeed: seed, loopCount: loops, ...(priority ? { chorusBoundaryPriority: true } : {}) });
}
function run(score: ReturnType<typeof fixture>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, () => {
  const result = advanceRollingBacking(score, checkpoint); checkpoint = result.checkpoint; return result;
 });
}

describe('declared chorus seam priority', () => {
 for (const style of ['swing', 'straight'] as const) it(`${style}: moves premature ending-section setups toward actual twelve-bar Blues seams`, () => {
  const counts = { oldEarly: 0, newEarly: 0, oldSeams: 0, newSeams: 0, skippedSeams: 0 };
  for (const seed of [7, 19, 42, 83, 101, 127, 149, 179]) {
   const score = fixture(true, seed, 1, style), before = run(fixture(false, seed, 1, style)), after = run(score);
   if (seed === 42 && style === 'swing') {
    const setupBars = (bars: typeof before) => bars.filter(b => b.ensembleDevelopment.drumPhrases[0].commentary.transform === 'setup').map(b => b.fromBar + 1);
    expect(setupBars(before)).toEqual([4, 8, 26, 40, 50]);
    expect(setupBars(after)).toEqual([4, 8, 16, 28, 40]);
   }
   if (seed === 42) console.info('default-blues-setups', JSON.stringify({ before: before.filter(b => b.ensembleDevelopment.drumPhrases[0].commentary.transform === 'setup').map(b => ({ absoluteBar: b.fromBar + 1, chorusBar: score.bars[b.fromBar].barInChorus! + 1, chorusLength: score.bars[b.fromBar].barsInChorus })), after: after.filter(b => b.ensembleDevelopment.drumPhrases[0].commentary.transform === 'setup').map(b => ({ absoluteBar: b.fromBar + 1, chorusBar: score.bars[b.fromBar].barInChorus! + 1, chorusLength: score.bars[b.fromBar].barsInChorus })) }));
   for (let i = 0; i < score.totalBars; i++) {
    const info = score.bars[i];
    const old = before[i].ensembleDevelopment.drumPhrases[0], next = after[i].ensembleDevelopment.drumPhrases[0];
    if (info.barInChorus === 9 && info.barsInChorus === 12) {
     counts.oldEarly += Number(old.commentary.transform === 'setup');
     counts.newEarly += Number(next.commentary.transform === 'setup');
    }
    if (info.isChorusFinalBar && info.barsInChorus === 12 && !info.isFinalBar) {
     counts.oldSeams += Number(old.commentary.transform === 'setup');
     counts.newSeams += Number(next.commentary.transform === 'setup');
     counts.skippedSeams += Number(next.commentary.transform !== 'setup');
     if (next.commentary.transform === 'setup') {
      expect(next.commentary.hits.length).toBeGreaterThan(0);
      expect(next.commentary.hits.every(hit => hit.beatOffset >= 2.5)).toBe(true);
      for (const hit of next.commentary.hits) expect(after[i].drumEvents.some(event => event.drum === hit.drum && event.absBeat === i * 4 + hit.beatOffset && event.role === 'commentary')).toBe(true);
     }
    }
    expect(after[i].drumEvents.length).toBeGreaterThan(0);
    expect(next.commentary.hits.length).toBeLessThanOrEqual(after[i].ensemblePlan.bars[0].drums.maxCommentaryHits);
   }
  }
  console.info('chorus-boundary', style, counts);
  expect(counts.oldEarly).toBeGreaterThan(0);
  expect(counts.newEarly).toBe(0);
  expect(counts.newSeams).toBeGreaterThan(counts.oldSeams);
  expect(counts.skippedSeams).toBeGreaterThan(0);
 });
 it('preserves full AABA section punctuation rather than treating all sections as engraving splits', () => {
  let internalSetups = 0;
  for (const seed of [7, 19, 42, 83]) {
   const score = fixture(true, seed, 1, 'swing', true), bars = run(score);
   for (let i = 0; i < bars.length; i++) if (score.bars[i].isSectionFinalBar && !score.bars[i].isChorusFinalBar) {
    expect(bars[i].ensemblePlan.trace[0].reasons).not.toContain('chorus_seam_priority');
    internalSetups += Number(bars[i].ensembleDevelopment.drumPhrases[0].commentary.transform === 'setup');
   }
  }
  expect(internalSetups).toBeGreaterThan(0);
 });
 it('keeps new seam policy causal, restorable and isolated from old checkpoints', () => {
  const score = fixture(true, 42, 2), three = fixture(true, 42, 3);
  const bars = run(score), longer = run(three);
  const events = (bar: typeof bars[number]) => [bar.bassEvents, bar.compEvents, bar.drumEvents, bar.ensemblePlan, bar.ensembleDevelopment];
  expect(bars.slice(0, 52).map(events)).toEqual(longer.slice(0, 52).map(events));
  for (const index of [13, 15, 25, 27, 39, 51, 65]) expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(bars[index].checkpoint)))).toEqual(bars[index + 1]);
  expect(() => advanceRollingBacking(fixture(false, 42, 2), bars[25].checkpoint)).toThrow();
  const first = planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo, bars: score.bars, endBarExclusive: 10 });
  expect(() => planEnsembleWindow({ phraseId: score.phraseId, tempo: score.tempo,
   bars: score.bars.map(({ chorusBoundaryPriority: _, ...bar }) => bar), memory: first.memory, endBarExclusive: 11 })).toThrow();
  const next = 27, checkpoint = bars[next - 1].checkpoint;
  const future = { barIndex: next + 1, observedAtBar: next + 1, source: 'scripted' as const, confidence: 1, noteDensity: 1, restBeats: 0 };
  expect(advanceRollingBacking(score, checkpoint, [future])).toEqual(bars[next]);
  const dense = advanceRollingBacking(score, checkpoint, [{ ...future, barIndex: next, observedAtBar: next }]);
  expect(dense.ensemblePlan.bars[0].drums.allowFill).toBe(false);
  expect(dense.ensembleDevelopment.drumPhrases[0].commentary.transform).not.toBe('setup');
  expect(bars.at(-1)!.ensemblePlan.bars[0].drums.allowFill).toBe(false);
 });
 for (const style of ['bossa-nova', 'ballad'] as const) it(`${style}: preserves its native policy exactly`, () => {
  expect(run(fixture(true, 42, 1, style))).toEqual(run(fixture(false, 42, 1, style)));
 });
});
