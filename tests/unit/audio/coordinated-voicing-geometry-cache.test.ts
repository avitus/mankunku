import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';
import type { CoordinatedVoicingMemory } from '$lib/audio/coordinated-voicing';

vi.mock('$lib/audio/voicings', async importOriginal => {
 const actual = await importOriginal<typeof import('$lib/audio/voicings')>();
 return { ...actual, quartalVoicing: vi.fn(actual.quartalVoicing) };
});
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
async function load() {
 const { resolveCoordinatedVoicing: resolve } = await import('$lib/audio/coordinated-voicing');
 const { quartalVoicing } = await import('$lib/audio/voicings');
 return { resolve, quartalVoicing: vi.mocked(quartalVoicing) };
}

describe('bounded history-independent voicing geometry reuse', () => {
 it('enumerates a legal geometry once while still resolving a different requested register', async () => {
  const { resolve, quartalVoicing } = await load();
  const input = { chord: { root: 'C' as const, quality: '7' as const }, family: 'quartal' as const, registerMidi: 54 };
  const low = resolve(input), enumerations = quartalVoicing.mock.calls.length;
  expect(enumerations).toBeGreaterThan(1);
  const high = resolve({ ...input, registerMidi: 76 });
  expect(high.notes).not.toEqual(low.notes);
  expect(quartalVoicing.mock.calls.length).toBe(enumerations);
  expect(resolve(input)).toEqual(low);
  expect(resolve(input).notes).not.toBe(low.notes);
 });
 it('never retains mutable chord or previous-history objects and continues to rank actual history', async () => {
  const { resolve } = await load();
  const chord = { root: 'G' as const, quality: '7' as const };
  const previous = JSON.parse(JSON.stringify(resolve({ chord: { root: 'C', quality: 'maj7' }, family: 'rootless-a', registerMidi: 60 }).memory)) as
   { version: 1; chord: CoordinatedVoicingMemory['chord']; notes: number[] };
  const originalPrevious = JSON.parse(JSON.stringify(previous));
  const input = { chord, family: 'rootless-a' as const, registerMidi: 62, previous, keyboardContraryMotion: true as const };
  const first = resolve(input), saved = JSON.parse(JSON.stringify(first));
  previous.notes = previous.notes.map(note => note + 12);
  const changed = resolve(input);
  expect(changed.decision.keyboardContraryMotion!.previousNotes).toEqual(previous.notes);
  expect(changed.notes).not.toEqual(first.notes);
  Object.assign(chord, { root: 'D' });
  expect(resolve(input).memory.chord.root).toBe('D');
  expect(first).toEqual(saved);
  expect(resolve({ ...input, chord: { root: 'G', quality: '7' }, previous: originalPrevious })).toEqual(first);
  expect(Object.isFrozen(first.notes)).toBe(true);
  expect(() => (first.notes as number[]).push(99)).toThrow();
 });
 it('keeps rootless two/three/full geometry separate and recomputes spacing, line and contrary preferences', async () => {
  const { resolve } = await load();
  const previous = resolve({ chord: { root: 'D', quality: 'min7' }, family: 'rootless-a', registerMidi: 60 }).memory;
  const input = { chord: { root: 'G' as const, quality: '7' as const }, family: 'rootless-b' as const, registerMidi: 62, previous };
  const full = resolve(input), two = resolve({ ...input, rootlessTexture: 'two' }), three = resolve({ ...input, rootlessTexture: 'three' });
  expect([two.notes.length, three.notes.length, full.notes.length]).toEqual([2, 3, 4]);
  const preference = { ...input, rootlessTexture: 'three' as const, spacing: 'open' as const, keyboardContraryMotion: true as const,
   keyboardLine: { style: 'swing' as const, stepSemitones: 2, contour: 'lift' as const, targetMidi: Math.min(84, previous.notes.at(-1)! + 2), anchorMidi: previous.notes.at(-1)!,
    maxGuideDetour: 2 as const, maxMovementDetour: 4 as const, maxTopLeap: 5 as const } };
  const warm = resolve(preference);
  vi.resetModules();
  const fresh = await load();
  expect(fresh.resolve(preference)).toEqual(warm);
  expect(resolve(input)).toEqual(full);
 });
 it('validates every warm request, including history and melodic bounds', async () => {
  const { resolve } = await load();
  const input = { chord: { root: 'C' as const, quality: 'maj7' as const }, family: 'rootless-a' as const, registerMidi: 62 };
  const previous = resolve(input).memory;
  for (const bad of [
   { ...input, registerMidi: NaN }, { ...input, spacing: 'wrong' }, { ...input, rootlessTexture: 'wrong' },
   { ...input, previous: { ...previous, notes: [60, 60, 64] } },
   { ...input, previous, keyboardLine: { contour: 'lift', targetMidi: 72, anchorMidi: 1, maxGuideDetour: 2, maxMovementDetour: 4, maxTopLeap: 5 } }
  ]) expect(() => resolve(bad as Parameters<typeof resolve>[0])).toThrow();
 });
 it('evicts old geometry after a bounded working set without changing the result or exposing cache-owned arrays', async () => {
  const { resolve, quartalVoicing } = await load();
  const probe = { chord: { root: 'C' as const, quality: '7' as const }, family: 'quartal' as const, registerMidi: 62 };
  const expected = resolve(probe), enumerations = quartalVoicing.mock.calls.length;
  for (const root of PITCH_CLASSES) for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) for (const family of ['shell', 'guide'] as const) {
   resolve({ chord: { root, quality }, family, registerMidi: 62 });
  }
  const restored = resolve(probe);
  expect(quartalVoicing.mock.calls.length).toBeGreaterThan(enumerations);
  expect(restored).toEqual(expected);
  expect(restored.notes).not.toBe(expected.notes);
 });
});
