import { describe, expect, it } from 'vitest';
import { createBlindListeningComparison, LISTENING_COMPARISON_CRITERIA, restoreListeningComparison, serializeListeningComparison } from '$lib/musicality/listening-comparison';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import { generateForBounce, harmonyDurationBeats, type BounceParams } from '$lib/audio/backing-bounce';
import { LISTENING_TUNES, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import type { BackingStyle } from '$lib/types/instruments';
import type { ListeningSnapshot } from '$lib/musicality/listening-player';
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
