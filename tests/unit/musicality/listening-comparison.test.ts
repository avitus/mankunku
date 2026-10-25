import { describe, expect, it } from 'vitest';
import { createBlindListeningComparison, LISTENING_COMPARISON_CRITERIA, restoreListeningComparison, serializeListeningComparison } from '$lib/musicality/listening-comparison';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { generateForBounce, harmonyDurationBeats, type BounceParams } from '$lib/audio/backing-bounce';
import { LISTENING_TUNES, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import type { BackingStyle } from '$lib/types/instruments';
import type { ListeningSnapshot } from '$lib/musicality/listening-player';
import { advanceRollingBacking, createRollingBacking, type RollingBackingBar } from '$lib/audio/backing-rolling';
import { aggregateRollingBacking } from '$lib/audio/backing-rolling-take';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import type { RollingBackingSnapshot } from '$lib/audio/backing-rolling-renderer';
const input = (): BounceParams => ({ phrase: structuredClone(BACKING_LAB_PRESETS[0].phrase), style: 'swing', tempo: 140, swing: 0.67, instrument: 'piano', volume: 0.6, mix: { ...DEFAULT_BACKING_MIX }, orchestration: 'coordinated' });
function completed(params: BounceParams): ListeningSnapshot {
 const durationBeats = harmonyDurationBeats(params.phrase);
 return { status: 'completed', params, generated: generateForBounce(params), ppq: 192, startAudioTime: 12,
  audioTime: 12 + durationBeats * 60 / params.tempo + 2.5, elapsedBeats: durationBeats, durationBeats,
  barIndex: Math.ceil(durationBeats / params.phrase.timeSignature[0])-1, ending: true, error: null };
}
const create = (rng = () => 0.25) => createBlindListeningComparison(input(), { buildVersion: 'test-build', rng, now: () => '2026-10-24T12:00:00.000Z', id: 'comparison-test' });
function finish(pair: ReturnType<typeof create>) {
 for (const label of ['A', 'B'] as const) {
  expect(pair.recordPlayback(label, completed(pair.paramsFor(label)))).toBe(true);
  for (const criterion of LISTENING_COMPARISON_CRITERIA) pair.rate(label, criterion.id, label === 'A' ? 4 : 3);
 }
 pair.setPreference('A'); pair.setNotes('The second chorus has more space.');
 return pair.reveal();
}
describe('blind full-tune musicality comparison', () => {
 it('conceals randomized assignment and captures equal independent inputs including seed and mix', () => {
  const original = input(); const pair = createBlindListeningComparison(original, { buildVersion: 'head', rng: () => 0.2 });
  original.tempo = 200; original.mix.comp = 0; original.phrase.id = 'changed';
  const a = pair.paramsFor('A'), b = pair.paramsFor('B');
  expect(a.orchestration).toBe('original'); expect(b.orchestration).toBe('coordinated');
  expect({ ...a, orchestration: undefined }).toEqual({ ...b, orchestration: undefined });
  expect(a.tempo).toBe(140); expect(a.mix.comp).toBe(1);
  a.mix.comp = 0; expect(pair.paramsFor('A').mix.comp).toBe(1);
  expect(pair.snapshot()).not.toHaveProperty('mapping'); expect(pair.snapshot().record).toBeNull();
  expect(create(() => 0.8).paramsFor('A').orchestration).toBe('coordinated');
 });
 it('accepts only completed playback with the frozen arrangement, clock and complete form', () => {
  const pair = create(); const correct = completed(pair.paramsFor('A'));
  for (const status of ['stopped', 'playing', 'loading', 'error'] as const) expect(pair.recordPlayback('A', { ...correct, status })).toBe(false);
  expect(pair.recordPlayback('A', { ...correct, elapsedBeats: correct.durationBeats-1 })).toBe(false);
  expect(pair.recordPlayback('A', { ...correct, audioTime: 12.01 })).toBe(false);
  expect(pair.recordPlayback('A', { ...correct, params: { ...correct.params!, tempo: 141 } })).toBe(false);
  expect(pair.recordPlayback('B', correct)).toBe(false);
  expect(pair.snapshot().completed).toEqual({ A: false, B: false });
  expect(pair.recordPlayback('A', correct)).toBe(true);
  correct.generated!.bassEvents.length = 0;
  expect(pair.snapshot().completed.A).toBe(true);
 });
 it('requires both full takes, independent complete ratings and a preference before revealing', () => {
  const pair = create(); expect(() => pair.reveal()).toThrow();
  expect(() => pair.rate('A', 'groove', 5)).toThrow(/complete/i);
  expect(() => pair.setPreference('tie')).toThrow(/complete/i);
  expect(pair.snapshot().canReveal).toBe(false);
  for (const label of ['A', 'B'] as const) {
   pair.recordPlayback(label, completed(pair.paramsFor(label)));
   for (const criterion of LISTENING_COMPARISON_CRITERIA) {
    if (label === 'A' && criterion.id === 'fatigue') continue;
    pair.rate(label, criterion.id, 4);
   }
  }
  expect(() => pair.reveal()).toThrow();
  pair.rate('A', 'fatigue', 4);
  expect(() => pair.reveal()).toThrow(); // Preference is independently required.
  pair.setPreference('tie'); expect(pair.snapshot().canReveal).toBe(true);
  const record = finish(pair);
  expect(record.mapping).toEqual({ A: 'original', B: 'coordinated' });
  expect(record.ratings.A.fatigue).toBe(4); expect(record.ratings.B.fatigue).toBe(3);
  expect(record.takes.A.generated!.bassEvents.length).toBeGreaterThan(0);
  expect(record.buildVersion).toBe('test-build'); expect(record.notes).toContain('second chorus');
  expect(Object.isFrozen(record.takes.A.generated!.bassEvents)).toBe(true);
  expect(() => pair.rate('A', 'groove', 1)).toThrow(); expect(() => pair.setPreference('B')).toThrow();
  expect(() => pair.setNotes('overwrite')).toThrow(); expect(pair.recordPlayback('A', completed(pair.paramsFor('A')))).toBe(false);
  expect(pair.reveal()).toBe(record);
 });
 it('rejects invalid scores and random values instead of coercing them', () => {
  const pair = create(); pair.recordPlayback('A', completed(pair.paramsFor('A'))); for (const score of [0, 6, 2.5, NaN]) expect(() => pair.rate('A', 'groove', score)).toThrow();
  expect(() => create(() => NaN)).toThrow(); expect(() => create(() => 1)).toThrow();
  expect(LISTENING_COMPARISON_CRITERIA.find(c => c.id === 'fatigue')!.hint).toMatch(/higher.*less tiring/i);
 });
 it('keeps opt-in terminal arrangements out of matched Original/Coordinated comparisons', () => {
  expect(() => createBlindListeningComparison({ ...input(), ending: 'hold-release' } as BounceParams, { buildVersion: 'ending-test' })).toThrow();
  expect(() => createBlindListeningComparison({ ...input(), ending: 'continue' } as BounceParams, { buildVersion: 'ending-test' })).not.toThrow();
  const record = JSON.parse(serializeListeningComparison(finish(create())));
  record.inputs.ending = 'hold-release';
  record.takes.A.params.ending = 'hold-release';
  record.takes.B.params.ending = 'hold-release';
  expect(restoreListeningComparison(JSON.stringify(record))).toBeNull();
 });
 it.each(LISTENING_TUNES.map(tune => [tune.title, tune.id] as const))('accepts full %s evidence at tempo, arrangement, style and mix boundaries', (_title, tuneId) => {
  const phrase = buildListeningTuneSession({ tuneId, soloChoruses: 4 }).phrase;
  for (const tempo of [40, 240]) for (const style of ['swing', 'straight', 'bossa-nova', 'ballad'] satisfies BackingStyle[]) {
   const mix = { ...DEFAULT_BACKING_MIX };
   for (const key of Object.keys(mix) as Array<keyof typeof mix>) mix[key] = tempo === 40 ? 0 : 3;
   const params = { ...input(), phrase, tempo, style, swing: tempo === 40 ? 0.5 : 0.8, volume: tempo === 40 ? 0 : 1, mix };
   const pair = createBlindListeningComparison(params, { buildVersion: 'full-matrix', rng: () => 0.75 });
   for (const label of ['A', 'B'] as const) {
    expect(pair.recordPlayback(label, completed(pair.paramsFor(label))), `${tuneId}/${tempo}/${style}/${label}`).toBe(true);
    for (const criterion of LISTENING_COMPARISON_CRITERIA) pair.rate(label, criterion.id, 3);
   }
   pair.setPreference('tie');
   expect(restoreListeningComparison(serializeListeningComparison(pair.reveal()))).not.toBeNull();
  }
 });
 it('round trips immutable revealed evidence and rejects incomplete or altered archives', () => {
  const record = finish(create()); const serialized = serializeListeningComparison(record);
  expect(restoreListeningComparison(serialized)).toEqual(record);
  expect(Object.isFrozen(restoreListeningComparison(serialized)!.ratings.A)).toBe(true);
  for (const mutate of [
   (v: any) => { v.revealed = false; }, (v: any) => { v.ratings.A.groove = 6; },
   (v: any) => { v.mapping.B = v.mapping.A; }, (v: any) => { v.takes.A.status = 'stopped'; },
   (v: any) => { v.inputs.tempo++; }, (v: any) => { v.takes.A.generated.bassEvents = 'broken'; },
   (v: any) => { v.takes.A.audioTime = 12.01; }
  ]) { const changed = JSON.parse(serialized); mutate(changed); expect(restoreListeningComparison(JSON.stringify(changed))).toBeNull(); }
  expect(restoreListeningComparison('{')).toBeNull(); expect(restoreListeningComparison('{}')).toBeNull();
 });
});

describe('causal take completion evidence in blind comparisons', () => {
 function causalCompleted(params: BounceParams): ListeningSnapshot {
  const take = completed(params);
  const definition = createRollingBacking(params.phrase.harmony, BACKING_STYLES[params.style], {
   phraseId: params.phrase.id, tempo: params.tempo, ppq: take.ppq, beatsPerBar: 4, swing: params.swing,
   performanceForm: params.phrase.performanceForm, ensemble: {}
  });
  const windows: RollingBackingBar[] = [];
  for (let bar = 0; bar < definition.totalBars; bar++) windows.push(advanceRollingBacking(definition, windows.at(-1)?.checkpoint));
  const last = windows.at(-1)!;
  const generated = { bassEvents: windows.flatMap(bar => bar.bassEvents), compEvents: windows.flatMap(bar => bar.compEvents), drumEvents: windows.flatMap(bar => bar.drumEvents) };
  const dispatches = [...new Set([...generated.bassEvents, ...generated.compEvents, ...generated.drumEvents].map(event => parseInt(event.time)))].sort((a, b) => a - b)
   .map(tick => ({ tick, audioTime: take.startAudioTime! + tick * 60 / params.tempo / take.ppq, status: 'played' as const }));
  take.generated = aggregateRollingBacking({ sessionId: definition.sessionId, status: 'stopped', nextBar: definition.totalBars,
   checkpointId: last.checkpoint.checkpointId, committedThroughTick: last.committedThroughTick, windows, generated, dispatches, schedule: null } satisfies RollingBackingSnapshot);
  take.provenance = { engine: 'causal-rolling', sessionId: definition.sessionId, fingerprint: definition.fingerprint,
   totalBars: definition.totalBars, committedBars: definition.totalBars, committedThroughTick: last.committedThroughTick, sessionStatus: 'complete', dispatches };
  return take;
 }
 it('retains actual causal policy and dispatch evidence through a revealed archive', () => {
  const pair = create();
  for (const label of ['A', 'B'] as const) {
   const params = pair.paramsFor(label);
   expect(pair.recordPlayback(label, params.orchestration === 'coordinated' ? causalCompleted(params) : completed(params))).toBe(true);
   for (const criterion of LISTENING_COMPARISON_CRITERIA) pair.rate(label, criterion.id, 3);
  }
  pair.setPreference('tie');
  const restored = restoreListeningComparison(serializeListeningComparison(pair.reveal()))!;
  expect(restored.takes.B.provenance).toMatchObject({ engine: 'causal-rolling', sessionStatus: 'complete' });
 });
 it.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('archives a complete longest-form %s comparison within the existing evidence bounds', style => {
  const phrase = buildListeningTuneSession({ tuneId: LISTENING_TUNES.find(tune => tune.title.includes('Saints'))!.id, soloChoruses: 4 }).phrase;
  const pair = createBlindListeningComparison({ ...input(), phrase, style, swing: BACKING_STYLES[style].defaultSwing }, { buildVersion: 'causal-bound', rng: () => .25 });
  for (const label of ['A', 'B'] as const) {
   const params = pair.paramsFor(label);
   expect(pair.recordPlayback(label, label === 'A' ? completed(params) : causalCompleted(params))).toBe(true);
   for (const criterion of LISTENING_COMPARISON_CRITERIA) pair.rate(label, criterion.id, 3);
  }
  pair.setPreference('tie');
  expect(restoreListeningComparison(serializeListeningComparison(pair.reveal()))).not.toBeNull();
 });
 it.each(['partial', 'ticks', 'session', 'pending', 'missing-dispatch', 'wrong-time', 'wrong-tick', 'missing-plan-bar', 'early-tail', 'wrong-arrangement'] as const)('rejects %s causal evidence even if its public status says completed', field => {
  const pair = create();
  const value = structuredClone(causalCompleted(pair.paramsFor('B')));
  const provenance = value.provenance! as any;
  if (field === 'partial') provenance.committedBars--;
  if (field === 'ticks') provenance.committedThroughTick--;
  if (field === 'session') provenance.sessionStatus = 'failed';
  if (field === 'pending') provenance.dispatches[0].status = 'scheduled';
  if (field === 'missing-dispatch') provenance.dispatches.pop();
  if (field === 'wrong-time') provenance.dispatches[0].audioTime += .5;
  if (field === 'wrong-tick') provenance.dispatches[0].tick++;
  if (field === 'missing-plan-bar') (value.generated!.ensemblePlan!.bars as unknown[]).pop();
  if (field === 'early-tail') value.audioTime = value.startAudioTime! + value.durationBeats * 60 / value.params!.tempo;
  if (field === 'wrong-arrangement') { value.params = pair.paramsFor('A'); expect(pair.recordPlayback('A', value)).toBe(false); return; }
  expect(pair.recordPlayback('B', value)).toBe(false);
 });
});
