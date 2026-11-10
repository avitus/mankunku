import { describe, expect, it } from 'vitest';
import { planBassDelayedRoot } from '$lib/audio/backing-bass-delayed-root';
import type { BassEvent } from '$lib/audio/backing-generation';

function events(pitches = [36, 38, 40, 43], offsets = [0, 1, 2, 3]): BassEvent[] {
 return pitches.map((midi, index) => ({ absBeat: 20 + offsets[index], time: `${(20 + offsets[index]) * 192}i`, midi, duration: .3, velocity: 80 }));
}
function plan(phraseId: string, overrides: Partial<Parameters<typeof planBassDelayedRoot>[0]> = {}) {
 return planBassDelayedRoot({ phraseId, tempo: 140, barIndex: 5, style: 'swing', rootPc: 0,
  third: 4, fifth: 7, previousMidi: 36, rootOffset: 1, repeatedHarmony: true, events: events(), ...overrides });
}
describe('causal delayed-root pitch selection', () => {
 it('sometimes starts on a third/fifth, reaches the root on the next native walking pulse, and leaves other events alone', () => {
  let selected = 0, retained = 0;
  for (let seed = 0; seed < 32; seed++) {
   const input = events(), result = plan(`delayed-${seed}`, { events: input });
   if (!result) { retained++; continue; }
   selected++;
   expect([4, 7]).toContain(result.startMidi % 12);
   expect(result.rootMidi % 12).toBe(0);
   expect(result.rootOffset).toBe(1);
   expect(Math.abs(result.startMidi - 36)).toBeLessThanOrEqual(5);
   expect(Math.abs(result.startMidi - result.rootMidi)).toBeLessThanOrEqual(5);
   expect(input).toEqual(events());
   expect(plan(`delayed-${seed}`, { events: input })).toEqual(result);
  }
  expect(selected).toBeGreaterThan(0); expect(retained).toBeGreaterThan(0);
 });
 it('keeps the Bossa root/fifth pitch vocabulary and reaches the root on its existing beat-three pulse', () => {
  const selected = Array.from({ length: 32 }, (_, i) => plan(`bossa-${i}`, { style: 'bossa-nova', previousMidi: 36,
   events: events([36, 31, 31, 36], [0, 1.5, 2, 3.5]), rootOffset: 2 })).filter(Boolean);
  expect(selected.length).toBeGreaterThan(0);
  for (const result of selected) {
   expect(result!.degree).toBe('fifth'); expect(result!.startMidi).toBe(31);
   expect(result!.rootMidi).toBe(36); expect(result!.rootOffset).toBe(2);
  }
 });
 it('uses native two-feel pulses for Ballad, without needing or adding quarter notes', () => {
  const selected = Array.from({ length: 32 }, (_, i) => plan(`ballad-${i}`, { style: 'ballad',
   events: events([36, 43], [0, 2]), rootOffset: 2 })).filter(Boolean);
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.every(result => result!.rootOffset === 2 && result!.rootMidi % 12 === 0)).toBe(true);
 });
 it('declines missing downbeat/root pulse, an unsupported seventh entrance and unsafe actual history', () => {
  for (let seed = 0; seed < 32; seed++) {
   const id = `reject-${seed}`;
   expect(plan(id, { events: events().slice(1) })).toBeUndefined();
   expect(plan(id, { events: events().filter(event => event.absBeat !== 21) })).toBeUndefined();
   expect(plan(id, { events: events([46, 38, 40, 43]) })).toBeUndefined();
   expect(plan(id, { previousMidi: 54 })).toBeUndefined();
   expect(plan(id, { previousMidi: null })).toBeUndefined();
  }
 });
 it('retains an existing third/fifth entrance and adds its later root without redirecting the preceding approach', () => {
  const selected = Array.from({ length: 64 }, (_, i) => plan(`nonroot-${i}`, { repeatedHarmony: false,
   previousMidi: 39, events: events([40, 38, 40, 43]) })).filter(Boolean);
  expect(selected.length).toBeGreaterThan(0);
  for (const result of selected) { expect(result!.startMidi).toBe(40); expect(result!.rootMidi).toBe(36); }
  for (let i = 0; i < 32; i++) expect(plan(`root-owned-${i}`, { repeatedHarmony: false })).toBeUndefined();
 });
 it('does not turn existing passing ornaments into an early root or introduce large internal leaps', () => {
  for (let seed = 0; seed < 32; seed++) {
   const input = events([36, 36, 38, 40], [0, .5, 1, 2]);
   expect(plan(`ornament-${seed}`, { events: input })).toBeUndefined();
   expect(plan(`leap-${seed}`, { events: events([36, 38, 54, 53]) })).toBeUndefined();
  }
 });
});
