import { describe, expect, it } from 'vitest';
import { planPerformanceEnergy } from '$lib/audio/performance-energy';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';

const soloForm = (count: number, length = 12) => buildPerformanceForm({ totalBars: count * length, sectionMap: [],
 choruses: Array.from({ length: count }, (_, index) => ({ role: 'solo' as const, startBar: index * length, endBarExclusive: (index + 1) * length })) });

describe('seeded performance waves', () => {
 it('develops across a blues chorus boundary without restarting the wave, and varies across take seeds', () => {
  const form = soloForm(4);
  const a = planPerformanceEnergy(form, { seed: 42 });
  const b = planPerformanceEnergy(form, { seed: 43 });
  expect(a).toEqual(planPerformanceEnergy(form, { seed: 42 }));
  expect(a).not.toEqual(b);
  expect(a).not.toEqual(planPerformanceEnergy(form));
  for (let i = 1; i < 44; i++) expect(Math.abs(a[i].targetEnergy - a[i-1].targetEnergy)).toBeLessThan(.065);
  expect(a[11].phase).toBe(a[12].phase);
  expect(Math.max(...a.slice(0, 24).map(bar => bar.targetEnergy))).toBeGreaterThan(a[0].targetEnergy + .1);
  expect(a.slice(20, 44).some((bar, index) => index > 0 && bar.targetEnergy < a[19 + index].targetEnergy)).toBe(true);
  expect(new Set(a.slice(0, 44).map(bar => bar.phase))).toContain('solo_release');
  expect(Math.max(...a.map(bar => bar.targetEnergy)) - Math.min(...a.map(bar => bar.targetEnergy))).toBeGreaterThan(.25);
 });
 it('varies the length of the relaxed opening instead of always building immediately', () => {
  const openings = Array.from({ length: 24 }, (_, seed) => {
   const arc = planPerformanceEnergy(soloForm(4), { seed });
   return arc.findIndex(bar => bar.targetEnergy > arc[0].targetEnergy);
  });
  expect(new Set(openings).size).toBeGreaterThan(1);
  expect(openings).toContain(1);
  expect(Math.max(...openings)).toBeGreaterThan(4);
 });
 it('does not rewrite the past when a future chorus is appended, except its explicitly known closing phrase', () => {
  const a = planPerformanceEnergy(soloForm(2), { seed: 42 });
  const b = planPerformanceEnergy(soloForm(4), { seed: 42 });
  expect(a.slice(0, 20)).toEqual(b.slice(0, 20));
  expect(a[20].targetEnergy).toBe(b[20].targetEnergy);
  expect(a[23].targetEnergy).toBeLessThanOrEqual(.4);
 });
 it('carries a seeded wave and checkpoint across a loop seam without rewriting the prefix when another loop is declared', () => {
  const harmony = [{ chord: { root: 'F' as const, quality: '7' as const }, scaleId: 'major.mixolydian', startOffset: [0, 1] as [number, number], duration: [12, 1] as [number, number] }];
  const params = { phraseId: 'seeded-wave-loop', tempo: 140, ppq: 192, beatsPerBar: 4, swing: .67, performanceForm: soloForm(1), ensemble: {} };
  const two = createRollingBacking(harmony, BACKING_STYLES.swing, params, { loopCount: 2, performanceEnergySeed: 42 });
  const three = createRollingBacking(harmony, BACKING_STYLES.swing, params, { loopCount: 3, performanceEnergySeed: 42 });
  expect(two.bars.slice(0, 20).map(bar => bar.performanceEnergy)).toEqual(three.bars.slice(0, 20).map(bar => bar.performanceEnergy));
  expect(two.bars[20].performanceEnergy?.phase).toBe('ending');
  expect(two.bars[20].performanceEnergy?.targetEnergy).toBe(three.bars[20].performanceEnergy?.targetEnergy);
  expect(three.bars[20].performanceEnergy?.phase).not.toBe('ending');
  let left: RollingBackingCheckpoint | undefined; let right: RollingBackingCheckpoint | undefined;
  for (let index = 0; index < 20; index++) {
   const a = advanceRollingBacking(two, left); const b = advanceRollingBacking(three, right);
   for (const key of ['bassEvents', 'compEvents', 'drumEvents', 'ensemblePlan', 'ensembleTiming', 'ensembleDevelopment'] as const) expect(a[key]).toEqual(b[key]);
   if (index === 12) {
    const serialized = JSON.stringify(left);
    expect(advanceRollingBacking(two, JSON.parse(serialized))).toEqual(a);
    expect(JSON.stringify(left)).toBe(serialized);
    expect(a).toMatchObject({ fromBar: 12, loopIndex: 1, sourceBarIndex: 0, previousCheckpointId: left!.checkpointId });
    expect(a.checkpoint.ensemble.performance.barsPlanned).toBe(13);
   }
   left = a.checkpoint; right = b.checkpoint;
  }
  expect(() => advanceRollingBacking(three, left)).toThrow('Invalid rolling checkpoint');
 });
 it('preserves head intentions and validates the seed, including zero', () => {
  const session = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const legacy = planPerformanceEnergy(session.phrase.performanceForm);
  const seeded = planPerformanceEnergy(session.phrase.performanceForm, { seed: 0 });
  expect(seeded.slice(0, 16)).toEqual(legacy.slice(0, 16));
  expect(seeded.slice(40)).toEqual(legacy.slice(40));
  expect(Object.isFrozen(seeded) && seeded.every(Object.isFrozen)).toBe(true);
  for (const seed of [NaN, Infinity, -1, .5, 2 ** 32]) expect(() => planPerformanceEnergy(session.phrase.performanceForm, { seed })).toThrow('seed');
 });
});

describe.each((['swing', 'straight', 'bossa-nova', 'ballad'] as const).flatMap(style => (['blues', 'aaba'] as const).map(tune => ({ style, tune }))))('$style $tune full-tune wave realization', ({ style, tune }) => {
 it('changes actual solo vocabulary without rewriting the opening head, and resumes exactly from a JSON checkpoint', () => {
  const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
  if (!admitted.ok) throw new Error(admitted.reason);
  const session = tune === 'blues' ? buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 }) : admitted.session;
  const { phrase, headBars, chorusBars } = session;
  const soloEnd = headBars + 2 * chorusBars;
  const tempo = style === 'ballad' ? 80 : 140;
  const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
   swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
  const score = createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params, { returningMelodySpace: true, performanceEnergySeed: 42 });
  const legacy = createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params, { returningMelodySpace: true });
  const other = createRollingBacking(phrase.harmony!, BACKING_STYLES[style], params, { returningMelodySpace: true, performanceEnergySeed: 43 });
  const run = (definition: typeof score) => {
   let checkpoint: RollingBackingCheckpoint | undefined;
   return Array.from({ length: definition.totalBars }, () => { const bar = advanceRollingBacking(definition, checkpoint); checkpoint = bar.checkpoint; return bar; });
  };
  const actual = run(score); const before = run(legacy);
  const events = (bars: typeof actual) => bars.map(bar => ({ bass: bar.bassEvents, comp: bar.compEvents, drums: bar.drumEvents }));
  expect(events(actual.slice(0, headBars))).toEqual(events(before.slice(0, headBars)));
  // Onsets/pitches/durations change, not just global loudness or trace metadata.
  const vocabulary = (bars: typeof actual) => JSON.stringify(events(bars), (key, value) => key === 'velocity' ? undefined : value);
  expect(vocabulary(actual.slice(headBars, soloEnd))).not.toEqual(vocabulary(before.slice(headBars, soloEnd)));
  expect(actual.every(bar => bar.bassEvents.length > 0 && bar.drumEvents.length > 0)).toBe(true);
  expect(actual.every(bar => bar.ensemblePlan.bars[0].energy <= (style === 'ballad' ? .6 : .9))).toBe(true);
  expect(score.bars.map(bar => bar.performanceEnergy)).toEqual(planPerformanceEnergy(phrase.performanceForm, { seed: 42 }));
  const middle = Math.floor(actual.length / 2);
  const checkpoint = JSON.parse(JSON.stringify(actual[middle].checkpoint));
  expect(advanceRollingBacking(score, checkpoint)).toEqual(actual[middle + 1]);
  expect(() => advanceRollingBacking(other, checkpoint)).toThrow('Invalid rolling checkpoint');
  expect(() => advanceRollingBacking(legacy, checkpoint)).toThrow('Invalid rolling checkpoint');
 });
});

// Fixed witness for the real-clock browser suite, whose existing breath/re-entry
// assertions must not depend on the new per-performance random seed.
describe.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s seeded browser witness', style => {
 it('keeps both admitted returning-head breaths and the native chord at offset three with seed 42 at 240 BPM', () => {
  const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
  if (!admitted.ok) throw new Error(admitted.reason);
  const session = style === 'swing' ? admitted.session : buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
  const { phrase } = session;
  const head = session.headBars + 2 * session.chorusBars;
  const score = createRollingBacking(phrase.harmony!, BACKING_STYLES[style], {
   phraseId: phrase.id, tempo: 240, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.62, BACKING_STYLES[style], 240),
   sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {},
   ...(style === 'ballad' ? { terminalArrangement: { ending: 'hold-release' as const, melody: phrase.notes } } : {})
  }, { returningMelodySpace: true, performanceEnergySeed: 42 });
  let checkpoint: RollingBackingCheckpoint | undefined;
  const bars = Array.from({ length: score.totalBars }, () => { const bar = advanceRollingBacking(score, checkpoint); checkpoint = bar.checkpoint; return bar; });
  for (const bar of bars.slice(head + 1, head + 3)) {
   expect(bar.ensemblePlan.bars[0].piano).toMatchObject({ maxAttacks: 0, silenceReason: 'returning_melody' });
   expect(bar.compEvents).toHaveLength(0);
   expect(bar.bassEvents.length).toBeGreaterThan(0);
   expect(bar.drumEvents.some(event => event.role === 'timekeeping')).toBe(true);
  }
  expect(bars[head + 3].compEvents.length).toBeGreaterThan(0);
 });
});
