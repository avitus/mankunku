import { describe, expect, it, vi } from 'vitest';
import { seedFrom } from '$lib/audio/generation-rng';
vi.mock('$lib/audio/generation-rng', async importOriginal => {
 const actual = await importOriginal<typeof import('$lib/audio/generation-rng')>();
 return { ...actual, seedFrom: vi.fn(actual.seedFrom) };
});
import { prepareEnsembleBars, planEnsembleWindow, type EnsembleBarContext, type EnsembleMemory, type SoloFeature } from '$lib/audio/ensemble-plan';

const source = (): EnsembleBarContext[] => Array.from({ length: 16 }, (_, barIndex) => ({
 barIndex, intensity: .55, isSectionFirstBar: barIndex % 8 === 0,
 isSectionFinalBar: barIndex % 8 === 7, isFinalBar: barIndex === 15,
 performanceEnergy: { phase: 'solo_build', chorusIndex: 0, targetEnergy: .55 }
} as EnsembleBarContext));
const input = { phraseId: 'prepared-ensemble', tempo: 140 };

describe('prepared static ensemble form', () => {
 it('fingerprints the owned form once, without repeating whole-form work for each planned bar', () => {
  vi.mocked(seedFrom).mockClear();
  const ordinary = source(), bars = prepareEnsembleBars(ordinary);
  const count = () => vi.mocked(seedFrom).mock.calls.filter(args => args[0] === 'ensemble-form').length;
  expect(count()).toBe(1);
  let memory: EnsembleMemory | undefined;
  for (let bar = 0; bar < bars.length; bar++) {
   memory = planEnsembleWindow({ ...input, bars, memory, endBarExclusive: bar + 1 }).memory;
  }
  expect(count()).toBe(1);
  planEnsembleWindow({ ...input, bars: ordinary });
  expect(count()).toBe(2);
 });
 it('owns an immutable detached form while caller edits remain independent', () => {
  const original = source(); const prepared = prepareEnsembleBars(original);
  expect(prepared).toEqual(original); expect(prepared).not.toBe(original);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.isFrozen(prepared[0].performanceEnergy)).toBe(true);
  const before = planEnsembleWindow({ ...input, bars: prepared });
  (original[0].performanceEnergy as { targetEnergy: number }).targetEnergy = .9;
  expect(planEnsembleWindow({ ...input, bars: prepared })).toEqual(before);
 });
 it('preserves every causal decision and memory across current evidence and JSON replay', () => {
  const ordinary = source(); const prepared = prepareEnsembleBars(ordinary);
  let memory: EnsembleMemory | undefined;
  for (let bar = 0; bar < ordinary.length; bar++) {
   const soloFeatures: SoloFeature[] = [{ barIndex: bar, observedAtBar: bar, source: 'scripted', confidence: 1, noteDensity: bar % 3 ? .9 : .1, restBeats: bar % 3 ? 0 : 2 }];
   const args = { ...input, startBar: bar, endBarExclusive: bar + 1, memory, soloFeatures };
   const expected = planEnsembleWindow({ ...args, bars: ordinary });
   expect(planEnsembleWindow({ ...args, bars: prepared })).toEqual(expected);
   expect(planEnsembleWindow({ ...args, bars: prepared, memory: memory && JSON.parse(JSON.stringify(memory)) })).toEqual(expected);
   memory = expected.memory;
  }
 });
 it('still rejects a changed external or shallow-frozen form on every call', () => {
  for (const shallow of [false, true]) {
   const mutable = source(); const bars = shallow ? Object.freeze(mutable) : mutable;
   planEnsembleWindow({ ...input, bars });
   (mutable[4].performanceEnergy as { targetEnergy: number }).targetEnergy = NaN;
   expect(() => planEnsembleWindow({ ...input, bars })).toThrow(/performance energy/);
   expect(() => prepareEnsembleBars(bars)).toThrow(/performance energy/);
  }
 });
 it('validates checkpoint form identity and live evidence even on a prepared form', () => {
  const bars = prepareEnsembleBars(source());
  const first = planEnsembleWindow({ ...input, bars, endBarExclusive: 1 });
  expect(() => planEnsembleWindow({ ...input, phraseId: 'other', bars, memory: first.memory })).toThrow();
  const changed = source(); (changed[1] as { intensity: number }).intensity = .7;
  expect(() => planEnsembleWindow({ ...input, bars: prepareEnsembleBars(changed), memory: first.memory })).toThrow();
 });
});
